import express from 'express';
import { registerUser, loginUser } from '../auth.js';

const router = express.Router();

router.post('/register', async (req, res) => {
    try {
        const { username, password, email } = req.body;
        const result = await registerUser(username, password, email);
        res.json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await loginUser(username, password);
        res.json(result);
    } catch (error) {
        res.status(401).json({ error: error.message });
    }
});

export default router;