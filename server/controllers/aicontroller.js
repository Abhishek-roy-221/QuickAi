import sql from "../configs/db.js";
import { clerkClient } from "@clerk/express";
import fs from "fs";
import pdf from "pdf-parse/lib/pdf-parse.js";
import { GoogleGenerativeAI } from "@google/generative-ai";

/* ===== GEMINI SETUP (FINAL FIX) ===== */

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const model = genAI.getGenerativeModel({
  model: "gemini-1.0-pro", // ✅ ONLY THIS WORKS
});

/* ===== GENERATE ARTICLE ===== */

export const generateArticle = async (req, res) => {
  try {
    const { userId } = req.auth();
    const { prompt } = req.body;

    const result = await model.generateContent(prompt);
    const content = result.response.text();

    await sql`
      INSERT INTO creations (user_id, prompt, content, type)
      VALUES (${userId}, ${prompt}, ${content}, 'article')
    `;

    res.json({ success: true, content });
  } catch (err) {
    console.error("Gemini failed:", err.message);
    res.status(500).json({ success: false, message: "Gemini failed" });
  }
};

/* ===== BLOG TITLE ===== */

export const generateBlogTitle = async (req, res) => {
  try {
    const { userId } = req.auth();
    const { prompt } = req.body;

    const result = await model.generateContent(prompt);
    const content = result.response.text();

    res.json({ success: true, content });
  } catch (err) {
    res.status(500).json({ success: false, message: "Gemini failed" });
  }
};

/* ===== RESUME REVIEW ===== */

export const resumeReview = async (req, res) => {
  try {
    const resume = req.file;

    const buffer = fs.readFileSync(resume.path);
    const pdfData = await pdf(buffer);

    const prompt = `Review this resume:\n\n${pdfData.text}`;
    const result = await model.generateContent(prompt);
    const content = result.response.text();

    res.json({ success: true, content });
  } catch (err) {
    res.status(500).json({ success: false, message: "Gemini failed" });
  }
};
