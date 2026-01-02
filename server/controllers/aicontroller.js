import OpenAI from "openai";
import sql from "../configs/db.js";
import { clerkClient } from "@clerk/express";
import axios from "axios";
import { v2 as cloudinary } from "cloudinary";
import fs from 'fs';
import pdf from 'pdf-parse/lib/pdf-parse.js';

// INITIALIZATION: 
// The v1beta endpoint is the most stable for the OpenAI shim.
// We remove the trailing slash to ensure the SDK appends paths correctly.
const AI = new OpenAI({
    apiKey: process.env.GEMINI_API_KEY,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai"
});

export const generateArticle = async (req, res) => {
    try {
        const { userId } = req.auth();
        const { prompt, length } = req.body;
        const plan = req.plan || 'free'; 
        const free_usage = Number(req.free_usage) || 0;

        if (plan !== 'premium' && free_usage >= 10) {
            return res.json({ success: false, message: "Limits reached. Upgrade to continue." });
        }

        // Using 'gemini-1.5-flash' with the explicit baseURL above
        const response = await AI.chat.completions.create({
            model: "gemini-1.5-flash",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
            max_tokens: Number(length) || 1000,
        });

        const content = response.choices[0]?.message?.content;
        if (!content) throw new Error("AI provider returned empty content");

        // Database insert
        try {
            await sql`INSERT INTO creations (user_id, prompt, content, type)
                      VALUES (${userId}, ${prompt}, ${content}, 'article')`;
        } catch (dbErr) {
            console.error("Database Insert Error:", dbErr.message);
        }

        if (plan !== 'premium') {
            await clerkClient.users.updateUserMetadata(userId, {
                privateMetadata: { free_usage: free_usage + 1 }
            });
        }

        res.json({ success: true, content });

    } catch (error) {
        console.error("ARTICLE_ERROR Details:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
}

export const generateBlogTitle = async (req, res) => {
    try {
        const { userId } = req.auth();
        const { prompt } = req.body;
        const plan = req.plan || 'free';
        const free_usage = Number(req.free_usage) || 0;

        if (plan !== 'premium' && free_usage >= 10) {
            return res.json({ success: false, message: "Limits reached. Upgrade to continue." });
        }

        const response = await AI.chat.completions.create({
            model: "gemini-1.5-flash",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
            max_tokens: 150,
        });

        const content = response.choices[0]?.message?.content;

        try {
            await sql`INSERT INTO creations (user_id, prompt, content, type)
                      VALUES (${userId}, ${prompt}, ${content}, 'blog-title')`;
        } catch (dbErr) { console.error("DB Error:", dbErr.message); }

        if (plan !== 'premium') {
            await clerkClient.users.updateUserMetadata(userId, {
                privateMetadata: { free_usage: free_usage + 1 }
            });
        }

        res.json({ success: true, content });
    } catch (error) {
        console.error("BLOG_TITLE_ERROR:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
}

export const generateImage = async (req, res) => {
    try {
        const { userId } = req.auth();
        const { prompt, publish } = req.body;
        if (req.plan !== 'premium') return res.json({ success: false, message: "Premium required" });

        const formData = new FormData();
        formData.append('prompt', prompt);

        const { data } = await axios.post("https://clipdrop-api.co/text-to-image/v1", formData, {
            headers: { 'x-api-key': process.env.CLIPDROP_API_KEY },
            responseType: "arraybuffer",
        });

        const base64Image = `data:image/png;base64,${Buffer.from(data, 'binary').toString('base64')}`;
        const { secure_url } = await cloudinary.uploader.upload(base64Image);

        await sql`INSERT INTO creations (user_id, prompt, content, type, publish)
                  VALUES (${userId}, ${prompt}, ${secure_url}, 'image', ${publish ?? false})`;

        res.json({ success: true, content: secure_url });
    } catch (error) {
        console.error("IMAGE_ERROR:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
}

export const removeImageBackground = async (req, res) => {
    try {
        const { userId } = req.auth();
        if (req.plan !== 'premium') return res.json({ success: false, message: "Premium required" });

        const { secure_url } = await cloudinary.uploader.upload(req.file.path, {
            transformation: [{ effect: 'background_removal' }]
        });

        await sql`INSERT INTO creations (user_id, prompt, content, type)
                  VALUES (${userId}, 'Background Removal', ${secure_url}, 'image')`;

        res.json({ success: true, content: secure_url });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}

export const removeImageObject = async (req, res) => {
    try {
        const { userId } = req.auth();
        const { object } = req.body;
        if (req.plan !== 'premium') return res.json({ success: false, message: "Premium required" });

        const { public_id } = await cloudinary.uploader.upload(req.file.path);
        const imageUrl = cloudinary.url(public_id, {
            transformation: [{ effect: `gen_remove:${object}` }],
            resource_type: 'image'
        });

        await sql`INSERT INTO creations (user_id, prompt, content, type)
                  VALUES (${userId}, 'Object Removal', ${imageUrl}, 'image')`;

        res.json({ success: true, content: imageUrl });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}

export const resumeReview = async (req, res) => {
    try {
        const { userId } = req.auth();
        if (req.plan !== 'premium') return res.json({ success: false, message: "Premium required" });

        const dataBuffer = fs.readFileSync(req.file.path);
        const pdfData = await pdf(dataBuffer);

        const prompt = `Review this resume: ${pdfData.text}`;
        const response = await AI.chat.completions.create({
            model: "gemini-1.5-flash",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 1500,
        });

        const content = response.choices[0].message.content;

        await sql`INSERT INTO creations (user_id, prompt, content, type)
                  VALUES (${userId}, 'Resume Review', ${content}, 'resume-review')`;

        res.json({ success: true, content });
    } catch (error) {
        console.error("RESUME_ERROR:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};