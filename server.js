const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch'); // npm install node-fetch
const app = express();

// Middleware
app.use(cors({
  origin: ['chrome-extension://*', 'https://*.netlify.app', 'http://localhost:3000']
}));
app.use(express.json());

// Cache simple en mémoire (remplace Redis)
const cache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

// Endpoint pour contourner CORS des APIs
app.get('/api/proxy', async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'URL parameter required' });
    }

    // Vérifier le cache
    const cacheKey = `proxy_${url}`;
    const cached = cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
      console.log('Cache hit for:', url);
      return res.json(cached.data);
    }

    // Appel API
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Fact-Checker-Bot/1.0',
        'Accept': 'application/json'
      },
      timeout: 10000
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    
    // Mettre en cache
    cache.set(cacheKey, {
      data: data,
      timestamp: Date.now()
    });

    res.json(data);

  } catch (error) {
    console.error('Proxy error:', error.message);
    res.status(500).json({ 
      error: 'Proxy failed', 
      message: error.message 
    });
  }
});

// Endpoint pour recherche sécurisée avec rate limiting
app.get('/api/search', async (req, res) => {
  try {
    const { query, source } = req.query;
    
    if (!query || !source) {
      return res.status(400).json({ error: 'Query and source required' });
    }

    const cacheKey = `search_${source}_${query}`;
    const cached = cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
      return res.json(cached.data);
    }

    let searchUrl = '';
    
    // Router vers différentes APIs selon la source
    switch(source) {
      case 'archive':
        searchUrl = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier,title,description&rows=3&output=json`;
        break;
      case 'pubmed':
        searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmode=json&retmax=3`;
        break;
      case 'openlibrary':
        searchUrl = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=3`;
        break;
      default:
        return res.status(400).json({ error: 'Invalid source' });
    }

    const response = await fetch(searchUrl, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Fact-Checker-Research/1.0'
      }
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const data = await response.json();
    
    // Cache résultat
    cache.set(cacheKey, {
      data: data,
      timestamp: Date.now()
    });

    res.json(data);

  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ 
      error: 'Search failed',
      message: error.message 
    });
  }
});

// Endpoint pour statistiques
app.get('/api/stats', (req, res) => {
  res.json({
    cacheSize: cache.size,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: Date.now()
  });
});

// Nettoyage du cache périodique
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      cache.delete(key);
    }
  }
  console.log(`Cache cleaned, size: ${cache.size}`);
}, 60 * 60 * 1000); // Toutes les heures

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: Date.now() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Backend fact-checker démarré sur port ${PORT}`);
  console.log(`📊 Stats disponibles sur /api/stats`);
});

// Export pour tests
module.exports = app;
