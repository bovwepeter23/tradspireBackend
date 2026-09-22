const nodemailer = require('nodemailer');

const createTransporter = () => {
  const port = Number(process.env.EMAIL_PORT || 587);

  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port,
    secure: port === 465,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
};

const sendEmail = async (options) => {
  const transporter = createTransporter();

  const message = {
    from: `${process.env.FROM_NAME} <${process.env.FROM_EMAIL}>`,
    to: options.email,
    subject: options.subject,
    html: options.html
  };

  await transporter.sendMail(message);
};

sendEmail.verify = async () => createTransporter().verify();

module.exports = sendEmail;