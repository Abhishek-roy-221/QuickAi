import { GoogleGenerativeAI } from "@google/generative-ai";
import sql from "../configs/db.js";
import { clerkClient } from "@clerk/express";
import axios from "axios";
import { v2 as cloudinary } from "cloudinary";
import fs from 'fs';
import pdf from 'pdf-parse/lib/pdf-parse.js';

// INITIALIZATION: Explicitly forcing 'v1' to stop the 404 errors found in your terminal
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    apiVersion: 'v1' 
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

        // AI Generation
        const result = await model.generateContent(`${prompt}. Write approximately ${length || 500} words.`);
        const response = await result.response;
        const content = response.text();

        if (!content) throw new Error("AI returned empty content");

        // DATABASE SAFETY: We wrap this in its own try-catch so a DB error doesn't break the whole app
        try {
            await sql`INSERT INTO creations (user_id, prompt, content, type)
                      VALUES (${userId}, ${prompt}, ${content}, 'article')`;
        } catch (dbErr) {
            console.error("DATABASE_SAVE_ERROR:", dbErr.message);
            // We don't throw here so the user still gets their article
        }

        // Update User Metadata
        if (plan !== 'premium') {
            await clerkClient.users.updateUserMetadata(userId, {
                privateMetadata: { free_usage: free_usage + 1 }
            });
        }

        res.json({ success: true, content });

    } catch (error) {
        console.error("FINAL_CRITICAL_ERROR:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
}

export const generateBlogTitle = async (req, res) => {
    try {
        const { userId } = req.auth();
        const { prompt } = req.body;
        const result = await model.generateContent("Generate a catchy blog title for: " + prompt);
        const response = await result.response;
        const content = response.text();

        try {
            await sql`INSERT INTO creations (user_id, prompt, content, type)
                      VALUES (${userId}, ${prompt}, ${content}, 'blog-title')`;
        } catch (dbErr) { console.error("DB_SAVE_ERROR:", dbErr.message); }

        res.json({ success: true, content });
    } catch (error) {
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
        const { secure_url } = await cloudinary.uploader.upload(req.file.path, { transformation: [{ effect: 'background_removal' }] });
        await sql`INSERT INTO creations (user_id, prompt, content, type) VALUES (${userId}, 'Background Removal', ${secure_url}, 'image')`;
        res.json({ success: true, content: secure_url });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
}

export const removeImageObject = async (req, res) => {
    try {
        const { userId } = req.auth();
        const { object } = req.body;
        const { public_id } = await cloudinary.uploader.upload(req.file.path);
        const imageUrl = cloudinary.url(public_id, { transformation: [{ effect: `gen_remove:${object}` }], resource_type: 'image' });
        await sql`INSERT INTO creations (user_id, prompt, content, type) VALUES (${userId}, 'Object Removal', ${imageUrl}, 'image')`;
        res.json({ success: true, content: imageUrl });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
}

export const resumeReview = async (req, res) => {
    try {
        const { userId } = req.auth();
        const dataBuffer = fs.readFileSync(req.file.path);
        const pdfData = await pdf(dataBuffer);
        const result = await model.generateContent(`Review this resume: ${pdfData.text}`);
        const response = await result.response;
        const content = response.text();
        await sql`INSERT INTO creations (user_id, prompt, content, type) VALUES (${userId}, 'Resume Review', ${content}, 'resume-review')`;
        res.json({ success: true, content });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};