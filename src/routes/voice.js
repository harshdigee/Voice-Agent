import { Router } from 'express';
import { inbound, collect } from '../controllers/voiceController.js';

const router = Router();

router.post('/inbound', inbound);
router.post('/collect', collect);

export default router;
