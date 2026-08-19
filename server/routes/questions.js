import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { Question, CNQuestion } from '../models/Question.js';
import { requireAuth, authorize } from '../middleware/auth.js';

const router = express.Router();
// Questions include answer scaffolding, evaluator scripts and optional learning
// materials. They are teacher-only; students receive a mode-filtered copy via
// the live/practice session endpoints.
router.use(requireAuth, authorize('faculty', 'admin'));

// Multer setup for image uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(process.cwd(), 'public', 'uploads');
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Create unique filename with original extension
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, uniqueSuffix + ext);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max file size
  fileFilter: function(req, file, cb) {
    // Accept only image files
    if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/)) {
      return cb(new Error('Only image files are allowed!'), false);
    }
    cb(null, true);
  }
});

const resourceUpload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(pdf|png|jpe?g|gif|webp)$/i.test(file.originalname);
    cb(allowed ? null : new Error('Only PDF and image resources are allowed.'), allowed);
  },
});

// POST api/questions - create a new question
router.post('/', async (req, res) => {
  try {
    const questionData = { ...req.body };
    
    // Parse JSON strings back to objects
    // ['precode', 'clientPrecode', 'solution', 'clientSolution', 'testCases'].forEach(field => {
    //   if (questionData[field]) {
    //     try {
    //       questionData[field] = JSON.parse(questionData[field]);
    //     } catch (e) {
    //       console.error(`Error parsing ${field}:`, e);
    //     }
    //   }
    // });

    // Create and save the question
    const Model = questionData.moduleType === 'CNQuestion' ? CNQuestion : Question;
    const question = new Model(questionData);
    await question.save();
    
    res.status(201).json({ 
      message: 'Question uploaded successfully', 
      question 
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST api/questions/upload-image - handle image uploads from Tiptap editor
router.post('/upload-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }
    
    // A relative URL works behind a reverse proxy and from every student PC.
    const imageUrl = `/uploads/${req.file.filename}`;
    res.json({ 
      success: true, 
      url: imageUrl
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/upload-resource', resourceUpload.single('resource'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No resource uploaded' });
    res.status(201).json({
      name: req.file.originalname,
      url: `/uploads/${req.file.filename}`,
      mimeType: req.file.mimetype || '',
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST api/questions/bulk - bulk upload questions
router.post('/bulk', async (req, res) => {
  try {
    const questions = req.body;
    
    if (!Array.isArray(questions)) {
      return res.status(400).json({ error: 'Request body must be an array of questions' });
    }
    
    const results = {
      success: [],
      failed: []
    };
    
    // Process each question
    for (const questionData of questions) {
      try {
        // Create new question
        const newQuestion = new CNQuestion({ ...questionData, moduleType: 'CNQuestion' });
        await newQuestion.save();
        
        results.success.push({
          id: newQuestion._id,
          title: newQuestion.title
        });
      } catch (err) {
        results.failed.push({
          title: questionData.title || 'Unknown',
          error: err.message
        });
      }
    }
    
    res.status(201).json({
      message: `Successfully created ${results.success.length} questions with ${results.failed.length} failures`,
      results
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT api/questions/:id - update(edit) question
router.put('/:id', async (req, res) => {
  try {
    // Look up the existing doc via the base model first (discriminators share
    // the same collection, so this always finds it regardless of type) to
    // find out which concrete model it actually is.
    const existing = await Question.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ message: 'Question not found' });
    }

    // IMPORTANT: must update through the correct discriminator model.
    // Updating a CNQuestion through the base `Question` model silently drops
    // CN-only fields (files, testcases, evalScript, input) because Mongoose's
    // default strict mode only allows fields defined on the model you call
    // findByIdAndUpdate through.
    const Model = existing.moduleType === 'CNQuestion' ? CNQuestion : Question;

    const updatedQuestion = await Model.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    res.status(200).json(updatedQuestion);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET api/questions - list all questions
router.get('/', async (req, res) => {
  try {
    const questions = await Question.find();
    res.json(questions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE api/questions/:id - delete a question
router.delete('/:id', async (req, res) => {
  try {
    const deletedQuestion = await Question.findByIdAndDelete(req.params.id);
    if (!deletedQuestion) {
      return res.status(404).json({ error: 'Question not found' });
    }
    res.json({ message: 'Question deleted successfully', question: deletedQuestion });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET api/questions/:id - get a specific question
router.get('/:id', async (req, res) => {
  try {
    const question = await Question.findById(req.params.id);
    if (!question) {
      return res.status(404).json({ error: 'Question not found' });
    }
    res.json(question);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
