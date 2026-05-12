import express from "express";
import path from "path";
import fs from "fs";
import multer from "multer";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Ensure fonts directory exists - use a consistent directory in the app root
  const fontsDir = path.join(process.cwd(), "fonts");
  if (!fs.existsSync(fontsDir)) {
    fs.mkdirSync(fontsDir, { recursive: true });
  }

  // Multer setup for font uploads
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, fontsDir);
    },
    filename: (req, file, cb) => {
      // Fix Multer's default latin1 encoding for Kurdish/Arabic characters
      const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
      const ext = path.extname(originalName);
      const name = path.basename(originalName, ext)
        .replace(/[^\u0600-\u06FF\u0750-\u077F\u0870-\u08FF\uFB50-\uFDFF\uFE70-\uFEFFa-z0-9._-]/gi, '');
      cb(null, `${name || 'font'}${ext}`);
    }
  });
  const upload = multer({ storage });

  app.use(express.json());
  
  // Health check for platform
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", env: process.env.NODE_ENV || 'development' });
  });

  // Log all requests to debug
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
  });

  // API: Upload Font
  app.post("/api/upload-font", (req, res, next) => {
    upload.single("font")(req, res, (err) => {
      if (err) {
        console.error("Multer error:", err);
        return res.status(500).json({ error: err.message });
      }
      const requestFile = (req as any).file;
      if (!requestFile) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      console.log("Uploaded:", requestFile.filename);
      res.json({ 
        success: true, 
        filename: requestFile.filename,
        path: `/assets/fonts/${encodeURIComponent(requestFile.filename)}`
      });
    });
  });

  // API: List Fonts
  app.get("/api/fonts", (req, res) => {
    try {
      const files = fs.readdirSync(fontsDir);
      const fonts = files
        .filter(f => f.endsWith(".ttf") || f.endsWith(".woff") || f.endsWith(".woff2") || f.endsWith(".otf"))
        .map(f => {
          // Derive a clean name: remove extension and replace multiple underscores with single space
          const name = f.split(".")[0].replace(/_+/g, " ").trim();
          return {
            name: name || f,
            filename: f,
            url: `/assets/fonts/${encodeURIComponent(f)}`
          };
        });
      res.json(fonts);
    } catch (e) {
      res.status(500).json({ error: "Could not list fonts" });
    }
  });

  // API: Delete Font - Using POST to be more robust with Unicode in body
  app.post("/api/fonts/delete", (req, res) => {
    const { filename } = req.body;
    
    if (!filename) {
      return res.status(400).json({ error: "Filename is required" });
    }

    console.log("Deletion attempt for:", filename);
    
    // Strategy: Try exactly as received, and try decoded
    const tryPaths = [
      path.join(fontsDir, filename)
    ];

    try {
      const decoded = decodeURIComponent(filename);
      if (decoded !== filename) {
        tryPaths.push(path.join(fontsDir, decoded));
      }
    } catch (e) {}

    // Security: Filter out any dangerous patterns
    const safePaths = tryPaths.filter(p => {
      const bname = path.basename(p);
      return !bname.includes('..') && !bname.includes('/') && !bname.includes('\\');
    });

    for (const filePath of safePaths) {
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
          console.log("Successfully deleted font:", filePath);
          return res.json({ success: true });
        } catch (err) {
          console.error("FS unlink error:", err);
        }
      }
    }

    console.error("Font not found on disk for any variation of:", filename);
    res.status(404).json({ error: "فۆنتەکە نەدۆزرایەوە لەسەر دیسک" });
  });

  // API Check (Legacy compatibility or direct calls)
  app.delete("/api/fonts/:filename", (req, res) => {
    // Redirect to the same logic if needed, but we prefer the POST version
    const filename = req.params.filename;
    // (Existing logic below is fine as a fallback, but let's just make it call the same internal logic)
    res.status(405).json({ error: "Please use POST /api/fonts/delete with {filename: '...'}" });
  });

  // Serve fonts directory explicitly so uploaded fonts are available immediately
  app.use("/assets/fonts", express.static(fontsDir));

  // Vite or Static Files
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production: Serve static files
    // When compiled to dist/server.js, the static files are in the same directory
    const distPath = path.resolve(process.cwd(), 'dist');
    const indexPath = path.join(distPath, 'index.html');
    
    console.log("Production Mode: Serving static assets from", distPath);
    
    app.use(express.static(distPath));
    
    // SPA Fallback
    app.get('*', (req, res, next) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/assets/fonts/')) {
        return next();
      }
      
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        console.error("Critical: index.html not found at", indexPath);
        res.status(404).send("Application not built correctly.");
      }
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on http://0.0.0.0:${PORT} [${process.env.NODE_ENV || 'development'}]`);
  });
}

startServer();
