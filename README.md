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

## Account API

- `GET /api/users/me` returns the signed-in user's profile. `PATCH /api/users/me` updates `name`, `email`, and/or `phone`; email changes are sent for verification when `ENABLE_EMAIL_VERIFICATION=true`.
- `PATCH /api/users/me/delivery-address` saves the default address. Required fields are `recipientName`, `phone`, `street`, `city`, and `country`; `region`, `postalCode`, and `instructions` are optional. The address can also be passed as `deliveryAddress` in the request body.
- `PATCH /api/users/me/password` requires `currentPassword` and `newPassword`. Changing the password invalidates existing sessions, so the user must sign in again.

All account routes above require `Authorization: Bearer <token>`.

## Order API

- `POST /api/orders` creates an order for the signed-in user. Send `items` as an array of `{ productId, quantity, purchaseType }`; `purchaseType` is `buy` or `rent`. Rental items also require `rentalDays` (1-365). Prices and totals are calculated from the current product data on the server.
- Pass a `deliveryAddress` object in the order request or use the user's saved default address. Orders store a snapshot of the address and item names/images/prices at checkout.
- `GET /api/orders/mine` lists the signed-in user's orders. `GET /api/orders/:id` returns an order to its owner or an admin.
- `PATCH /api/orders/:id/cancel` lets the order owner cancel an order while it is `pending`, `confirmed`, or `processing`. The optional request field `reason` records why.
- Admins can use `GET /api/orders` (optionally `?status=pending`) to list orders and `PATCH /api/orders/:id/status` with `{ "status": "processing" }` to update status. Supported statuses are `pending`, `confirmed`, `processing`, `shipped`, `delivered`, and `cancelled`. Delivered and cancelled orders are terminal.

## Product API

- `GET /api/products` and `GET /api/products/:id` are public catalog reads.
- `POST /api/products`, `PUT /api/products/:id`, and `DELETE /api/products/:id` require `Authorization: Bearer <token>` and an admin account.
- Create and image-changing updates use `multipart/form-data`; metadata-only updates may use JSON. Product fields include `name`, `categories`, `availableFor`, `price`, `rentPricePerDay`, `origin`, `description`, and `imageAlt`. `categories` accepts a JSON array, comma-separated values, or repeated form fields. `availableFor` accepts `buy`, `rent`, `both`, or a JSON array such as `["buy","rent"]`. `price` is required when `buy` is selected; `rentPricePerDay` is required when `rent` is selected. The legacy `category` field is retained and maps to the first category.
- New products require a main image. Upload it in `mainImage` (or legacy `image`) and optionally attach up to 10 repeated `subImages` fields. Each file can be up to 4 MB. Updates can replace the main image by sending a new `mainImage`; sending one or more `subImages` replaces the sub-image list. Set `clearSubImages=true` to remove all sub-images without uploading replacements. Images are stored server-side in Cloudinary.
- Product responses preserve the legacy `category`, `price`, and `image` fields and also include `categories`, `availableFor`, `rentPricePerDay`, and `subImages`.

## Carousel Image API

- `GET /api/carousel-images` is public and returns active carousel images ordered by `sortOrder`.
- `GET /api/carousel-images/manage` requires an admin account and returns active and inactive images.
- `POST /api/carousel-images`, `PUT /api/carousel-images/:id`, and `DELETE /api/carousel-images/:id` require an admin account. Create and update use `multipart/form-data`; upload the image in the `image` field (up to 4 MB).
- Optional carousel fields are `title`, `description`, `imageAlt`, `linkUrl`, `sortOrder`, and `isActive`.

Set the same `MONGO_URI`, `JWT_SECRET`, and `CLOUDINARY_*` values in the production API environment (for example, Vercel project environment variables). Set `FRONTEND_URL` to the deployed frontend origin.