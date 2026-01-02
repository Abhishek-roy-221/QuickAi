import sql from "../configs/db.js";
import { clerkClient } from "@clerk/express";
import axios from "axios";
import { v2 as cloudinary } from "cloudinary";
import fs from "fs";
import pdf from "pdf-parse/lib/pdf-parse.js";
import FormData from "form-data";
import { GoogleGenerativeAI } from "@google/generative-ai";

/* ================= GEMINI SETUP ================= */

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ✅ THIS MODEL WORKS FOR ALL PROJECTS
const model = genAI.getGenerativeModel({
  model: "gemini-pro",
});

/* ================= TEXT ================= */

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
    console.error("GEMINI ERROR:", err.message);
    res.json({ success: false, message: "Gemini failed" });
  }
};

export const generateBlogTitle = async (req, res) => {
  try {
    const { userId } = req.auth();
    const { prompt } = req.body;

    const result = await model.generateContent(prompt);
    const content = result.response.text();

    await sql`
      INSERT INTO creations (user_id, prompt, content, type)
      VALUES (${userId}, ${prompt}, ${content}, 'blog-title')
    `;

    res.json({ success: true, content });
  } catch (err) {
    console.error("GEMINI ERROR:", err.message);
    res.json({ success: false, message: "Gemini failed" });
  }
};

export const resumeReview = async (req, res) => {
  try {
    const { userId } = req.auth();
    const resume = req.file;

    if (!resume) {
      return res.json({ success: false, message: "Resume missing" });
    }

    const buffer = fs.readFileSync(resume.path);
    const pdfData = await pdf(buffer);

    const prompt = `
Review the following resume and give constructive feedback:

${pdfData.text}
    `;

    const result = await model.generateContent(prompt);
    const content = result.response.text();

    await sql`
      INSERT INTO creations (user_id, prompt, content, type)
      VALUES (${userId}, 'Resume Review', ${content}, 'resume-review')
    `;

    res.json({ success: true, content });
  } catch (err) {
    console.error("GEMINI ERROR:", err.message);
    res.json({ success: false, message: "Gemini failed" });
  }
};

/* ================= IMAGE (UNCHANGED) ================= */

export const generateImage = async (req, res) => {
  try {
    const { userId } = req.auth();
    const { prompt, publish } = req.body;

    const formData = new FormData();
    formData.append("prompt", prompt);

    const { data } = await axios.post(
      "https://clipdrop-api.co/text-to-image/v1",
      formData,
      {
        headers: {
          "x-api-key": process.env.CLIPDROP_API_KEY,
          ...formData.getHeaders(),
        },
        responseType: "arraybuffer",
      }
    );

    const base64Image = `data:image/png;base64,${Buffer.from(
      data,
      "binary"
    ).toString("base64")}`;

    const { secure_url } = await cloudinary.uploader.upload(base64Image);

    await sql`
      INSERT INTO creations (user_id, prompt, content, type, publish)
      VALUES (${userId}, ${prompt}, ${secure_url}, 'image', ${publish ?? false})
    `;

    res.json({ success: true, content: secure_url });
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: err.message });
  }
};
