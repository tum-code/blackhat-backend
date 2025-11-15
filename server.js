const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Serve uploaded files
app.use('/files', express.static(uploadsDir));

// Database setup - Using file-based SQLite for persistence
const db = new sqlite3.Database('./tools.db');

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS tools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    author TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    file_size INTEGER,
    upload_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    download_count INTEGER DEFAULT 0
  )`);
});

// File upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

// API Routes

// Get all tools
app.get('/api/tools', (req, res) => {
  db.all('SELECT * FROM tools ORDER BY upload_date DESC', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Get tools by category
app.get('/api/tools/:category', (req, res) => {
  const category = req.params.category;
  db.all('SELECT * FROM tools WHERE category = ? ORDER BY upload_date DESC', [category], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Upload new tool with file
app.post('/api/upload', upload.single('toolFile'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const { name, author, category, description } = req.body;
  
  const tool = {
    name,
    author,
    category,
    description,
    filename: req.file.filename,
    original_name: req.file.originalname,
    file_size: req.file.size
  };

  db.run(
    `INSERT INTO tools (name, author, category, description, filename, original_name, file_size) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [tool.name, tool.author, tool.category, tool.description, tool.filename, tool.original_name, tool.file_size],
    function(err) {
      if (err) {
        // Delete the uploaded file if DB insert fails
        try {
          fs.unlinkSync(path.join(uploadsDir, req.file.filename));
        } catch (e) {}
        return res.status(500).json({ error: err.message });
      }
      
      res.json({
        id: this.lastID,
        message: 'Tool uploaded successfully to our servers!',
        tool: {
          ...tool,
          id: this.lastID,
          download_count: 0
        }
      });
    }
  );
});

// Download tool
app.get('/api/download/:id', (req, res) => {
  const toolId = req.params.id;
  
  db.get('SELECT * FROM tools WHERE id = ?', [toolId], (err, tool) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!tool) {
      return res.status(404).json({ error: 'Tool not found' });
    }

    // Update download count
    db.run('UPDATE tools SET download_count = download_count + 1 WHERE id = ?', [toolId]);

    const filePath = path.join(uploadsDir, tool.filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found on server' });
    }

    // Set download headers
    res.setHeader('Content-Disposition', `attachment; filename="${tool.original_name}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    
    // Stream file to user
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
  });
});

// Get tool statistics
app.get('/api/stats', (req, res) => {
  db.get('SELECT COUNT(*) as total_tools, SUM(download_count) as total_downloads FROM tools', (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(row);
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'BlackHat Tools Server is running',
    timestamp: new Date().toISOString()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'BlackHat Tools API Server',
    endpoints: {
      'GET /api/tools': 'Get all tools',
      'GET /api/tools/:category': 'Get tools by category',
      'POST /api/upload': 'Upload new tool with file',
      'GET /api/download/:id': 'Download tool file',
      'GET /api/stats': 'Get platform statistics'
    }
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 BlackHat Tools Server running on port ${PORT}`);
  console.log(`📁 File uploads directory: ${uploadsDir}`);
  console.log(`💾 Database file: ./tools.db`);
});