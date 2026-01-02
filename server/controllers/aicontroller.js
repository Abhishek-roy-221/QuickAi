import axios from "axios";
import sql from "../configs/db.js";
import { clerkClient } from "@clerk/express";
import fs from "fs";
import pdf from "pdf-parse/lib/pdf-parse.js";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent";

const geminiRequest = async (prompt) => {
  const { data } = await axios.post(
    `${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`,
    {
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
    }
  );

  return data.candidates[0].content.parts[0].text;
};

/* ================= TEXT FEATURES ================= */

export const generateArticle = async (req, res) => {
  try {
    const { userId } = req.auth();
    const { prompt } = req.body;
    const plan = req.plan;
    const free_usage = req.free_usage;

    if (plan !== "premium" && free_usage >= 10) {
      return res.json({
        success: false,
        message: "Limits reached. Upgrade to continue.",
      });
    }

    const content = await geminiRequest(prompt);

    await sql`
      INSERT INTO creations (user_id, prompt, content, type)
      VALUES (${userId}, ${prompt}, ${content}, 'article')
    `;

    if (plan !== "premium") {
      await clerkClient.users.updateUserMetadata(userId, {
        privateMetadata: { free_usage: free_usage + 1 },
      });
    }

    res.json({ success: true, content });
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.json({ success: false, message: "Gemini generation failed" });
  }
};

export const generateBlogTitle = async (req, res) => {
  try {
    const { userId } = req.auth();
    const { prompt } = req.body;

    const content = await geminiRequest(prompt);

    await sql`
      INSERT INTO creations (user_id, prompt, content, type)
      VALUES (${userId}, ${prompt}, ${content}, 'blog-title')
    `;

    res.json({ success: true, content });
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.json({ success: false, message: "Gemini generation failed" });
  }
};

export const resumeReview = async (req, res) => {
  try {
    const { userId } = req.auth();
    const resume = req.file;
    const plan = req.plan;

    if (plan !== "premium") {
      return res.json({
        success: false,
        message: "This feature is only available for premium users",
      });
    }

    const buffer = fs.readFileSync(resume.path);
    const pdfData = await pdf(buffer);

    const prompt = `Review this resume and give feedback:\n\n${pdfData.text}`;
    const content = await geminiRequest(prompt);

    await sql`
      INSERT INTO creations (user_id, prompt, content, type)
      VALUES (${userId}, 'Resume Review', ${content}, 'resume-review')
    `;

    res.json({ success: true, content });
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.json({ success: false, message: "Gemini generation failed" });
  }
};
