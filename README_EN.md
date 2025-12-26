# CloudHost

[中文版 README](./README.md)

> Upload your frontend build and get a public URL instantly.

🚀 **Start using CloudHost** → https://cloudhost.yourdomain.com  
📦 No config · No server · No CDN setup

---

## What is CloudHost?

**CloudHost is a production-ready static site deployment platform.**

It solves a simple but common problem for frontend developers:

> Your frontend is already built.  
> You just need a link that works.

With CloudHost, you don’t need to care about servers, object storage,
CDN configuration, HTTPS, or cache headers.

Just upload a `.zip` file.  
CloudHost handles everything else.

---

## 🚀 How to use (30 seconds)

1. Build your frontend project locally  
   (for example, `npm run build`, producing a `dist/` folder)
2. Zip the build output
3. Upload the `.zip` to CloudHost
4. **Get a publicly accessible URL instantly**

No configuration files.  
No DevOps knowledge required.

---

## 🎯 When should you use CloudHost?

> CloudHost is not a replacement for Netlify or Vercel —
> it’s what you use when you just need a working link, now.

CloudHost focuses on **fast delivery**, not complex pipelines.

It is ideal for:

- Frontend demos and prototypes
- Landing pages and marketing pages
- Sharing work with clients or teammates
- Indie hackers shipping ideas quickly
- Internal previews and reviews

If your goal is simply:

> **“Give someone a link they can open”**

CloudHost is the fastest way.

---

## 🤔 Why not self-host?

You can absolutely build your own setup:

- Object storage
- CDN
- Domains and HTTPS
- Cache policies
- Permissions and quotas
- Abuse prevention
- Traffic and cost monitoring

But in practice, this means:

- More configuration
- More maintenance
- More things that can break

**CloudHost solves these operational problems upfront.**

Out of the box, you get:

- 🌍 Dedicated public domain with CDN acceleration
- 🔒 HTTPS enabled by default
- ⚡ Smart caching strategy  
  - HTML is never cached (instant updates)
  - JS / CSS / assets are long-term cached for performance
- 🧯 Server-side authentication and quota enforcement
- 📊 Basic traffic and cost awareness

You focus on frontend development.  
CloudHost handles the rest.

---

## 👥 Who is CloudHost for?

- Frontend developers (React, Vue, or any static site)
- Indie hackers and solo builders
- Teams that want fast previews
- Anyone who doesn’t want to manage servers

CloudHost is not trying to replace full CI/CD systems.  
It makes **publishing a frontend page trivial**.

---

## 🔐 Stability & Security

CloudHost is not a demo project.  
It is a fully engineered platform:

- All deployments and deletions happen on the server
- No critical logic is trusted to the frontend
- Sites are isolated by user and project
- Directory traversal and invalid structures are blocked
- Uploaded content is checked via COS content security
- Sites can be taken down or removed at any time

This is a service designed for long-term use.

---

## 🧠 How CloudHost works (optional reading)

CloudHost is built on Tencent Cloud infrastructure:

- **CloudBase** for authentication, cloud functions, and database
- **COS** for static asset storage
- **EdgeOne** for CDN, HTTPS, and wildcard domains

Cloud functions handle:

- Authentication and role checks
- Deployment and redeployment
- Site management
- Traffic metrics
- Basic cost estimation

This is a real production system, not a sample project.

---

## 📦 About open source

CloudHost is open-sourced for transparency and learning purposes.

However:

> **This repository is not a plug-and-play template.**

It deeply depends on Tencent Cloud services
(CloudBase, COS, EdgeOne, IAM configuration).

If you simply want to use CloudHost,
**the hosted platform is the recommended way.**

---

## 📄 License

- License follows the repository declaration
- Learning and reference are welcome
- Forking does not guarantee a runnable setup

---

## ✨ In short

> CloudHost is not about how to deploy frontend code.  
> It is about **how fast you can deliver a working link**.

🚀 **Start using CloudHost** → https://cloudhost.yourdomain.com
