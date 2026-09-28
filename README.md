# Tradspire Backend

Express API for Tradspire accounts and the product catalog. Products are stored in MongoDB; uploaded product images are stored in Cloudinary.

## Local setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and provide a MongoDB connection string, a strong `JWT_SECRET`, and Cloudinary credentials.
3. Start the API with `npm run dev`. It listens on port `5000` by default.
4. From the workspace root, serve the frontend with `npx --yes http-server .\tradspireFrontend\public -p 8000`. The frontend uses `http://localhost:5000` automatically on localhost; set `window.TRADSPIRE_API_URL` before loading `js/api.js` if the API runs elsewhere.

Cloudinary credentials are available in the Cloudinary dashboard under API keys. Keep `CLOUDINARY_API_SECRET` only in the backend environment; never put it in frontend code.

## First admin account

Register through the frontend, then promote that account directly in MongoDB using an operator-controlled database session:

```javascript
db.users.updateOne(
	{ email: "admin@example.com" },
	{ $set: { role: "admin" } }
)
```

Sign out and back in after promotion so the frontend receives the updated role. Public registration always creates a `user`; product writes also verify the account role from MongoDB on every request.

## Product API

- `GET /api/products` and `GET /api/products/:id` are public catalog reads.
- `POST /api/products`, `PUT /api/products/:id`, and `DELETE /api/products/:id` require `Authorization: Bearer <token>` and an admin account.
- Create and update requests use `multipart/form-data`; the optional `image` field (up to 4 MB) is uploaded server-side to `tradspire/products` in Cloudinary. New products require an image.

Set the same `MONGO_URI`, `JWT_SECRET`, and `CLOUDINARY_*` values in the production API environment (for example, Vercel project environment variables). Set `FRONTEND_URL` to the deployed frontend origin.