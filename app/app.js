// ==============================================================================
// Sample Application - Hello DevOps
// A simple Express.js web server for demonstrating the CI/CD pipeline
// ==============================================================================

const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Main endpoint
app.get('/', (req, res) => {
    res.json({
        message: 'Hello DevOps! 🚀',
        version: process.env.APP_VERSION || '1.0.0',
        hostname: require('os').hostname(),
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString()
    });
});

// Info endpoint
app.get('/info', (req, res) => {
    res.json({
        app: 'hello-devops',
        description: 'Sample application for Kubernetes CI/CD pipeline',
        kubernetes: true,
        registry: 'Nexus (192.168.56.20:8082)',
        cicd: 'Jenkins'
    });
});

// Start server
if (require.main === module) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Hello DevOps app running on port ${PORT}`);
    });
}

module.exports = app;
