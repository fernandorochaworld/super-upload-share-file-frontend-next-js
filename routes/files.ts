import express from 'express';
import multer from 'multer';
import { UploadApiResponse, v2 as cloudinary } from 'cloudinary';
import File from '../models/File';
import https from 'https';
import nodemailer from 'nodemailer';
import createEmailTemplate from '../utils/createEmailTemplate';

const router = express.Router();

const storage = multer.diskStorage({});

let upload = multer({
    storage,
});

router.post('/upload', upload.single('myFile'), async (req, res) => {
    try {
        if (!req.file)
            return res.status(400).json({ message: 'Hey bro! We need the file' });

        console.log(req.file);
        let uploadedFile: UploadApiResponse;
        try {
            uploadedFile = await cloudinary.uploader.upload(req.file.path, {
                folder: 'shareme',
                resource_type: 'auto'
            });
        } catch (error) {
            // console.log(error.message);
            console.log('Cloudinary Error');
            return res.status(400).json({ message: 'Cloudinary Error' });
        }

        const { originalname } = req.file;
        const { secure_url, bytes, format } = uploadedFile;
        const data = {
            filename: originalname,
            sizeInBytes: bytes,
            secure_url,
            format,
        };
        console.log(data)
        const file = await File.create(data);
        res.status(200).json({
            id: file._id,
            downloadPageLink: `${process.env.API_BASE_ENDPOINT_CLIENT}download/${file._id}`,
        });

    } catch (error) {
        // console.log(error.message);
        console.log('File upload server error.', error);
        res.status(500).json({ message: 'Server Error :(' });
    }
});


router.get('/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const file = await File.findById(id);
        if (!file) {
            return res.status(404).json({ message: 'File does not exists.' });
        }

        const { filename, format, sizeInBytes } = file;
        return res.status(200).json({
            name: filename,
            sizeInBytes,
            format,
            id,
        });

    } catch (error) {
        return res.status(500).json({ message: 'Server Error :(' });
    }
});

router.get('/:id/download', async (req, res) => {
    try {
        const id = req.params.id;
        const file = await File.findById(id);
        if (!file) {
            return res.status(404).json({ message: 'File does not exists.' });
        }

        https.get(file.secure_url, (fileStream) => fileStream.pipe(res));

    } catch (error) {
        return res.status(500).json({ message: 'Server Error :(' });
    }
});

router.post('/email', async (req, res) => {
    // 1 - validate request.
    const { id, emailFrom, emailTo } = req.body;

    if (!id ||!emailFrom || !emailTo)
        return res.status(400).json({ message: 'All fields are required.'});

    // 2 - check if file exists.
    const file = await File.findById(id);
    if (!file) {
        return res.status(404).json({ message: 'File does not exists.' });
    }

    if (file.sender)
        return res.status(400).json({ message: 'File is already sent.'});

    // 3 - create transporter.
    const authParam = {
        // @ts-ignore
        host: process.env.BRAVO_SMTP_HOST,
        port: process.env.BRAVO_SMTP_PORT,
        // secure: true,
        auth: {
            // TODO: replace `user` and `pass` values from <https://forwardemail.net>
            user: process.env.BRAVO_SMTP_USER,
            pass: process.env.BRAVO_SMTP_PASSWORD,
        }
    };
    // @ts-ignore
    const transporter = nodemailer.createTransport(authParam);
    // 4 - prepare the e-mail data.
    const { filename, sizeInBytes } = file;
    const fileSize = `${(Number(sizeInBytes) / (1024 * 1024)).toFixed(2)} MB`;
    const downloadPageLink = `${process.env.API_BASE_ENDPOINT_CLIENT}download/${file._id}`;
    const mailOptions = {
        from: emailFrom, // sender address
        to: emailTo, // list of receivers
        subject: 'File shared with you', // Subject line
        text: `${emailFrom} shared a file with you`, // plain text body
        html: createEmailTemplate(
            emailFrom,
            downloadPageLink,
            filename,
            fileSize
        ), // html body
    };
    console.log('sending', authParam, { ...mailOptions, html: '' });
    // 5 - send mail using the transporter.
    const info = await transporter.sendMail(mailOptions, async (error, info) => {
        if (error) {
            console.log(error);
            return res.status(500).json({
                message: 'server error :('
            });
        }

        file.sender = emailFrom;
        file.receiver = emailTo;

        await file.save();
        return res.status(200).json({
            message: 'Email Sent'
        });
    });
    // 6 - save the data and send the response.
});

export default router;