import { GoogleGenerativeAI } from "@google/generative-ai";
import sql from "../configs/db.js";
import { clerkClient } from "@clerk/express";

/* ---------- GEMINI SETUP (FINAL) ---------- */
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const model = genAI.getGenerativeModel(
  { model: "gemini-1.5-flash" },
  { apiVersion: "v1" } // 🔥 THIS IS THE FIX
);

/* ---------- ARTICLE ---------- */
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
    console.error("Gemini error:", err);
    res.status(500).json({
      success: false,
      message: "Gemini failed",
    });
  }
};
