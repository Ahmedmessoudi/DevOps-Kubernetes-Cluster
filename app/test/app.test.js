// ==============================================================================
// Unit Tests for Hello DevOps Application
// ==============================================================================

const request = require('supertest');
const app = require('../app');

describe('Hello DevOps App', () => {

    // Test main endpoint
    test('GET / should return welcome message', async () => {
        const response = await request(app).get('/');
        expect(response.status).toBe(200);
        expect(response.body.message).toBe('Hello DevOps! 🚀');
        expect(response.body).toHaveProperty('hostname');
        expect(response.body).toHaveProperty('timestamp');
    });

    // Test health endpoint
    test('GET /health should return healthy status', async () => {
        const response = await request(app).get('/health');
        expect(response.status).toBe(200);
        expect(response.body.status).toBe('healthy');
    });

    // Test info endpoint
    test('GET /info should return app information', async () => {
        const response = await request(app).get('/info');
        expect(response.status).toBe(200);
        expect(response.body.app).toBe('hello-devops');
        expect(response.body.kubernetes).toBe(true);
    });

    // Test 404
    test('GET /unknown should return 404', async () => {
        const response = await request(app).get('/unknown');
        expect(response.status).toBe(404);
    });
});
