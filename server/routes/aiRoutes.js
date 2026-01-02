import express from "express";
import { upload } from "../configs/multer.js";

import {
  generateArticle,
  generateBlogTitle,
  resumeReview,
} from "../controllers/aicontroller.js";

const router = express.Router();

router.post("/generate-article", generateArticle);
router.post("/generate-blog-title", generateBlogTitle);
router.post("/resume-review", upload.single("resume"), resumeReview);

export default router;
