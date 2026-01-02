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

const model = genAI.getGenerativeModel({
  model: "models/gemini-1.5-flash",
});

/* ================= TEXT FEATURES ================= */

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
  } catch (error) {
    console.error("generateArticle:", error);
    res.status(500).json({ success: false, message: "Gemini failed" });
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
  } catch (error) {
    console.error("generateBlogTitle:", error);
    res.status(500).json({ success: false, message: "Gemini failed" });
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

    const prompt = `Review this resume and give feedback:\n\n${pdfData.text}`;

    const result = await model.generateContent(prompt);
    const content = result.response.text();

    await sql`
      INSERT INTO creations (user_id, prompt, content, type)
      VALUES (${userId}, 'Resume Review', ${content}, 'resume-review')
    `;

    res.json({ success: true, content });
  } catch (error) {
    console.error("resumeReview:", error);
    res.status(500).json({ success: false, message: "Gemini failed" });
  }
};

/* ================= IMAGE FEATURES ================= */

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
  } catch (error) {
    console.error("generateImage:", error);
    res.status(500).json({ success: false, message: "Image generation failed" });
  }
};

export const removeImageBackground = async (req, res) => {
  try {
    const image = req.file;

    const { secure_url } = await cloudinary.uploader.upload(image.path, {
      transformation: [{ effect: "background_removal" }],
    });

    res.json({ success: true, content: secure_url });
  } catch (error) {
    console.error("removeImageBackground:", error);
    res.status(500).json({ success: false });
  }
};

export const removeImageObject = async (req, res) => {
  try {
    const { object } = req.body;
    const image = req.file;

    const { public_id } = await cloudinary.uploader.upload(image.path);

    const imageUrl = cloudinary.url(public_id, {
      transformation: [{ effect: `gen_remove:${object}` }],
    });

    res.json({ success: true, content: imageUrl });
  } catch (error) {
    console.error("removeImageObject:", error);
    res.status(500).json({ success: false });
  }
};
