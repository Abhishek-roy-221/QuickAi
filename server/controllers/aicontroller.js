import { GoogleGenerativeAI } from "@google/generative-ai";
import sql from "../configs/db.js";
import { clerkClient } from "@clerk/express";
import axios from "axios";
import { v2 as cloudinary } from "cloudinary";
import fs from 'fs';
import pdf from 'pdf-parse/lib/pdf-parse.js';

// Initialize the Official Google SDK
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// We use 'gemini-1.5-flash' here - the SDK handles the URL versioning automatically
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

export const generateArticle = async (req, res) => {
    try {
        const { userId } = req.auth();
        const { prompt, length } = req.body;
        const plan = req.plan || 'free'; 
        const free_usage = Number(req.free_usage) || 0;

        if (plan !== 'premium' && free_usage >= 10) {
            return res.json({ success: false, message: "Limits reached. Upgrade to continue." });
        }

        // Official SDK Method
        const result = await model.generateContent(prompt + `. Write approximately ${length || 500} words.`);
        const response = await result.response;
        const content = response.text();

        if (!content) throw new Error("AI returned empty content");

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
        console.error("GEMINI_ERROR:", error.message);
        res.status(500).json({ success: false, message: "AI Error: " + error.message });
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

        const result = await model.generateContent("Generate a catchy blog title for: " + prompt);
        const response = await result.response;
        const content = response.text();

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

        const prompt = `Review this resume and give feedback: ${pdfData.text}`;
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const content = response.text();

        await sql`INSERT INTO creations (user_id, prompt, content, type)
                  VALUES (${userId}, 'Resume Review', ${content}, 'resume-review')`;

        res.json({ success: true, content });
    } catch (error) {
        console.error("RESUME_ERROR:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};