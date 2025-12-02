import express from 'express';
import { getUserById, getAllUsers } from '../models/db.js';

const router = express.Router();

router.get('/profile', async (req, res) => {
    try {
        const user = await getUserById(req.user.id);
        if (!user) {
            return res.status(404).json({ error: '用户不存在' });
        }
        res.json({ user });
    } catch (error) {
        res.status(500).json({ error: '服务器错误' });
    }
});

router.get('/all', async (req, res) => {
    try {
        const users = await getAllUsers();
        res.json({ users });
    } catch (error) {
        res.status(500).json({ error: '服务器错误' });
    }
});

export default router;