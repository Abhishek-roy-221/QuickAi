import axios from "axios";
import sql from "../configs/db.js";
import { clerkClient } from "@clerk/express";
import fs from "fs";
import pdf from "pdf-parse/lib/pdf-parse.js";
import { v2 as cloudinary } from "cloudinary";
import FormData from "form-data";

/* ================= GEMINI REST SETUP ================= */

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent";

const geminiRequest = async (prompt) => {
  const { data } = await axios.post(
    `${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`,
    {
      contents: [{ parts: [{ text: prompt }] }],
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
      return res.json({ success: false, message: "Limit reached" });
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
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: "Gemini failed" });
  }
};

export const generateBlogTitle = async (req, res) => {
  try {
    const content = await geminiRequest(req.body.prompt);

    await sql`
      INSERT INTO creations (user_id, prompt, content, type)
      VALUES (${req.auth().userId}, ${req.body.prompt}, ${content}, 'blog-title')
    `;

    res.json({ success: true, content });
  } catch (err) {
    res.json({ success: false, message: "Gemini failed" });
  }
};

export const resumeReview = async (req, res) => {
  try {
    const buffer = fs.readFileSync(req.file.path);
    const pdfData = await pdf(buffer);

    const content = await geminiRequest(
      `Review this resume:\n\n${pdfData.text}`
    );

    await sql`
      INSERT INTO creations (user_id, prompt, content, type)
      VALUES (${req.auth().userId}, 'Resume Review', ${content}, 'resume-review')
    `;

    res.json({ success: true, content });
  } catch (err) {
    res.json({ success: false, message: "Resume review failed" });
  }
};

/* ================= IMAGE FEATURES (UNCHANGED) ================= */

export const generateImage = async (req, res) => {
  const formData = new FormData();
  formData.append("prompt", req.body.prompt);

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

  const base64 = Buffer.from(data).toString("base64");
  const { secure_url } = await cloudinary.uploader.upload(
    `data:image/png;base64,${base64}`
  );

  res.json({ success: true, content: secure_url });
};

export const removeImageBackground = async (req, res) => {
  const { secure_url } = await cloudinary.uploader.upload(req.file.path, {
    transformation: [{ effect: "background_removal" }],
  });

  res.json({ success: true, content: secure_url });
};

export const removeImageObject = async (req, res) => {
  const { public_id } = await cloudinary.uploader.upload(req.file.path);

  const imageUrl = cloudinary.url(public_id, {
    transformation: [{ effect: `gen_remove:${req.body.object}` }],
  });

  res.json({ success: true, content: imageUrl });
};
