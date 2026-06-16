# Demox

[中文版 README](./README.md)

> Upload your frontend build and get a public URL instantly.

🚀 **Start using Demox** → https://demox.site/  
📦 No config · No server · No CDN setup

---

## What is Demox?

**Demox is a production-ready static site deployment platform.**

It solves a simple but common problem for frontend developers:

> Your frontend is already built.  
> You just need a link that works.

With Demox, you don't need to care about servers, object storage,
CDN configuration, HTTPS, or cache headers.

Just upload a `.zip` file.  
Demox handles everything else.

---

## 🚀 How to use (30 seconds)

1. Build your frontend project locally  
   (for example, `npm run build`, producing a `dist/` folder)
2. Zip the build output
3. Upload the `.zip` to Demox
4. **Get a publicly accessible URL instantly**

### Upload methods

| Method | Description |
|--------|-------------|
| **Web Console** | Open [demox.site](https://demox.site), log in, and drag & drop |
| **CLI** | One-command deploy from terminal, great for CI/CD |
| **MCP Server** | Deploy directly from Claude Code, Cursor, or other AI tools |
| **API** | Programmatic deployment via REST API |

---

## 🎯 When should you use Demox?

> Demox is not a replacement for Netlify or Vercel —
> it's what you use when you just need a working link, now.

Demox focuses on **fast delivery**, not complex pipelines.

It is ideal for:

- Frontend demos and prototypes
- Landing pages and marketing pages
- Sharing work with clients or teammates
- Indie hackers shipping ideas quickly
- Internal previews and reviews
- Converting PDF, Markdown, or DOCX documents into shareable web pages

If your goal is simply:

> **"Give someone a link they can open"**

Demox is the fastest way.

---

## 📦 Toolchain

Demox provides a complete set of deployment tools for different workflows.

### CLI

```bash
# Install
npm install -g @demox-site/cli@latest

# Login
demox login

# Deploy
demox deploy ./dist

# Deploy documents (PDF, Markdown, DOCX auto-converted to web pages)
demox deploy ./document.pdf
demox deploy ./notes.md --template warm
```

See [CLI README](../cli/README.md) for full usage.

### MCP Server (AI Tool Integration)

Deploy directly from Claude Code, Cursor, or other AI tools:

```json
{
  "mcpServers": {
    "demox": {
      "command": "npx",
      "args": ["-y", "@demox-site/mcp-server@latest"],
      "env": {
        "DEMOX_SITE_URL": "https://demox.site",
        "DEMOX_API_URL": "https://your-api-url"
      }
    }
  }
}
```

See [MCP Server README](../mcp-server/README.md) for full usage.

### API Token

Generate an API token in Console → Settings → API Tokens for script or CI/CD integration.

---

## 🗂️ Projects & Site Management

### Projects

Group multiple sites into projects for better organization and batch operations.

### Custom Subdomains

Assign a custom subdomain prefix to any site:

```
https://my-demo.demox.site
```

Set it up from the console or CLI — no DNS configuration needed.

### Site Visibility

- **Public**: Anyone with the link can access
- **Private**: Only logged-in users can access (great for internal previews)

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

**Demox solves these operational problems upfront.**

Out of the box, you get:

- 🌍 Dedicated public domain with CDN acceleration
- 🔒 HTTPS enabled by default
- ⚡ Smart caching strategy  
  - HTML is never cached (instant updates)
  - JS / CSS / assets are long-term cached for performance
- 🧯 Server-side authentication and quota enforcement
- 📊 Basic traffic and cost awareness

You focus on frontend development.  
Demox handles the rest.

---

## 👥 Who is Demox for?

- Frontend developers (React, Vue, or any static site)
- Indie hackers and solo builders
- Teams that want fast previews
- Anyone who doesn't want to manage servers

Demox is not trying to replace full CI/CD systems.  
It makes **publishing a frontend page trivial**.

---

## 🔐 Stability & Security

Demox is not a demo project.  
It is a fully engineered platform:

- All deployments and deletions happen on the server
- No critical logic is trusted to the frontend
- Sites are isolated by user and project
- Directory traversal and invalid structures are blocked
- Uploaded content is checked via COS content security
- Sites can be taken down or removed at any time
- Private site access control (login required)
- Subdomain routing with SPA fallback

This is a service designed for long-term use.

---

## 🧩 Supported File Types

| Type | Description |
|------|-------------|
| Directory | Auto-packaged into ZIP |
| ZIP | Uploaded directly |
| PDF | Auto-generates preview page |
| Markdown | Auto-generates page with template |
| TXT | Auto-generates page with template |
| DOCX | Auto-converted to web page |

Document templates: `insight`, `warm`, `dark` (via `--template` flag).

---

## 🧠 How Demox works (optional reading)

Demox is built on Tencent Cloud infrastructure:

- **SCF (Cloud Functions)** for authentication, the user system, and all core business logic
- **MySQL (TencentDB)** for user, site, and permission data
- **COS** for static asset storage
- **EdgeOne** for CDN, HTTPS, wildcard domains, and edge routing

Cloud functions handle:

- Authentication and role checks
- Deployment and redeployment
- Site and project management
- Custom subdomain routing
- Traffic metrics
- Basic cost estimation

Edge functions handle:

- `*.demox.site` subdomain routing resolution
- Private site access control
- SPA fallback (navigation vs static resources via Accept header)
- "Powered by Demox" badge injection

This is a real production system, not a sample project.

---

## 📦 About open source

Demox is open-sourced for transparency and learning purposes.

However:

> **This repository is not a plug-and-play template.**

It deeply depends on Tencent Cloud services
(SCF, MySQL, COS, EdgeOne, IAM configuration).

If you simply want to use Demox,
**the hosted platform is the recommended way.**

---

## 📄 License

- License follows the repository declaration
- Learning and reference are welcome
- Forking does not guarantee a runnable setup

---

## ✨ In short

> Demox is not about how to deploy frontend code.  
> It is about **how fast you can deliver a working link**.

🚀 **Start using Demox** → https://demox.site/
