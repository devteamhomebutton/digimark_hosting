# DigiMark Social Calendar

Content calendar and task management platform for marketing teams. Built with **Node.js/Express** backend and **React** frontend, ready to deploy on **Windows hosting (IIS + iisnode)**.

---

## Quick Overview

| Component | Tech |
|-----------|------|
| Backend | Node.js + Express.js |
| Frontend | React + TypeScript + Vite (pre-built in `static/`) |
| Database | MySQL 8.0 |
| Auth | JWT + bcrypt |
| Server | IIS + iisnode (Windows hosting) |

---

## Deployment Guide (myWindowsHosting.com)

### Step 1: Create MySQL Database

1. Log in to your **myWindowsHosting.com** control panel
2. Go to **Databases** > **MySQL Databases**
3. Create a new database (e.g., `digimark_social`)
4. Create a database user with a strong password
5. Assign the user to the database with **ALL PRIVILEGES**
6. Note down:
   - Database Host (usually `localhost` or a specific hostname shown in the panel)
   - Database Name
   - Database Username
   - Database Password

### Step 2: Import Database

1. Go to **phpMyAdmin** from your hosting control panel
2. Select the database you just created
3. Click **Import** tab
4. Upload the file `digimark_db.sql` from this repo
5. Click **Go** to import

This will create all tables and load demo data including:
- 1 client (Heiley Office 360) with 5 verticals
- 100+ content calendar items
- Tasks, pipeline templates, and team members

### Step 3: Deploy Code

**Option A: Git Deploy (Recommended)**

If your hosting supports Git:
1. Go to your site's **File Manager** or SSH
2. Navigate to the site root directory
3. Run:
   ```
   git clone https://github.com/devteamhomebutton/digimark_hosting.git .
   ```

**Option B: Manual Upload**

1. Download this repo as ZIP from GitHub
2. Extract and upload ALL files to your site root via **File Manager** or **FTP**
3. Make sure files are in the root (not inside a subfolder):
   ```
   site-root/
   ├── server.js          <-- must be at root
   ├── web.config
   ├── package.json
   ├── package-lock.json
   ├── .env.example
   ├── app/
   │   ├── config.js
   │   ├── database.js
   │   ├── middleware/
   │   ├── routes/
   │   └── utils/
   └── static/
       ├── index.html
       └── assets/
   ```

### Step 4: Create `.env` File

1. In the site root, create a file named `.env`
2. Copy the contents from `.env.example` and fill in your values:

```env
# Database - use credentials from Step 1
DB_HOST=your-mysql-host
DB_PORT=3306
DB_USER=your-db-username
DB_PASSWORD=your-db-password
DB_NAME=your-db-name

# JWT Secret - generate a random string (minimum 32 characters)
# You can use: https://randomkeygen.com/ (use a 256-bit key)
SECRET_KEY=paste-a-random-64-character-string-here

# Token Expiry
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7

# App
NODE_ENV=production
ALLOWED_ORIGINS=http://homebutton-002-site7.atempurl.com,https://homebutton-002-site7.atempurl.com

# Debug (set to false in production)
DEBUG=false
```

> **Important:** Replace the `ALLOWED_ORIGINS` with your actual site URL if using a custom domain.

### Step 5: Install Dependencies

Via SSH or Node.js console on the hosting:

```bash
npm install --production
```

This installs all required packages (~270 packages, takes 1-2 minutes).

### Step 6: Verify

1. Open your site URL: `http://homebutton-002-site7.atempurl.com`
2. You should see the login page
3. Log in with the demo credentials below

If you see a 502 error, check:
- `.env` file exists with correct DB credentials
- `npm install` was completed
- Node.js is enabled for your site in the hosting panel
- Check `iisnode/` folder for error logs

---

## Demo Login Credentials

All demo accounts use the password: **`Admin@123`**

| Email | Role | Access Level |
|-------|------|-------------|
| `admin@digimark.com` | Admin | Full access - manage team, clients, settings |
| `manager@digimark.com` | Manager | Manage tasks, approve content, view reports |
| `designer@digimark.com` | Graphic Designer | Assigned design tasks |
| `social@digimark.com` | SM Specialist | Social media content management |
| `seo@digimark.com` | SEO Specialist | SEO-related tasks |
| `member@digimark.com` | Team Member | Basic task access |

---

## Demo Data Included

The database dump includes pre-loaded data for immediate testing:

- **Client:** Heiley Office 360
- **Verticals:** Heiley Spaces, Heiley Office 360, Heiley Stays, Founder Branding, Lead Generation
- **Content:** 100+ calendar items across May-June 2026 (posts, reels, carousels, videos, stories)
- **Tasks:** Assigned tasks with pipeline stages
- **Pipeline Templates:** Video (10 stages), Festival Shoot (9), Event (8), Poster (7), Shooting (6)
- **Team:** 7 users with different roles

---

## API Endpoints

All API endpoints are prefixed with `/api/v1/` (except auth).

| Module | Prefix | Endpoints |
|--------|--------|-----------|
| Auth | `/auth` | `POST /login`, `POST /register`, `POST /refresh`, `POST /logout`, `GET /me`, `PUT /me` |
| Clients | `/api/v1/clients` | `GET /`, `POST /`, `GET /:id`, `PUT /:id`, `DELETE /:id`, `GET /:id/stats` |
| Calendar | `/api/v1` | `GET /clients/:id/calendar`, `GET /clients/:id/calendar/:date`, `POST /clients/:id/content`, `GET /content/:id`, `PUT /content/:id`, `DELETE /content/:id`, `PATCH /content/:id/status` |
| Tasks | `/api/v1/tasks` | `GET /my-tasks`, `GET /daily`, `GET /overview`, `GET /general`, `POST /general`, `POST /daily/bulk`, `GET /:id`, `PUT /:id`, `DELETE /:id`, `PATCH /:id/status`, `PATCH /:id/assign` |
| Content Tasks | `/api/v1` | `GET /content/:id/tasks`, `POST /content/:id/tasks`, `POST /content/:id/tasks/pipeline`, `POST /content/:id/tasks/reorder` |
| Dashboard | `/api/v1/dashboard` | `GET /` |
| Team | `/api/v1/team` | `GET /`, `POST /invite`, `PUT /:id/role`, `PATCH /:id/status`, `DELETE /:id` |
| Verticals | `/api/v1` | `GET /verticals`, `GET /clients/:id/verticals`, `POST /clients/:id/verticals`, `PUT /verticals/:id`, `DELETE /verticals/:id` |
| Approvals | `/api/v1/approvals` | `GET /pending`, `POST /`, `PATCH /:id/approve`, `PATCH /:id/request-changes`, `GET /task/:id` |
| Pipeline Templates | `/api/v1` | `GET /pipeline-templates`, `GET /pipeline-templates/categories`, `POST /pipeline-templates/categories`, `PUT /pipeline-templates/:category`, `POST /pipeline-templates/:category/reset`, `GET /stage-library`, `POST /stage-library` |
| Imports | `/api/v1` | `GET /import/content/template`, `POST /import/content/:id`, `GET /import/tasks/general/template`, `POST /import/tasks/general/:id` |
| Reports | `/api/v1/reports` | `GET /data`, `GET /export/excel`, `GET /export/pdf`, `GET /filter-options` |
| Health | `/` | `GET /health` |

---

## Project Structure

```
├── server.js                 # Express app entry point
├── web.config                # IIS + iisnode configuration
├── package.json              # Node.js dependencies
├── .env.example              # Environment variables template
├── digimark_db.sql           # MySQL database dump with demo data
├── app/
│   ├── config.js             # App configuration (reads .env)
│   ├── database.js           # MySQL connection pool (mysql2)
│   ├── middleware/
│   │   ├── auth.js           # JWT authentication + bcrypt
│   │   └── errorHandler.js   # Global error handler
│   ├── routes/
│   │   ├── auth.js           # Login, register, token refresh
│   │   ├── clients.js        # Client CRUD
│   │   ├── calendar.js       # Calendar + content CRUD
│   │   ├── tasks.js          # Task management + pipeline stages
│   │   ├── contentTasks.js   # Content-specific tasks
│   │   ├── dashboard.js      # Dashboard summary stats
│   │   ├── team.js           # Team member management
│   │   ├── verticals.js      # Client verticals/pillars
│   │   ├── approvals.js      # Task approval workflow
│   │   ├── pipelineTemplates.js  # Pipeline stage templates
│   │   ├── imports.js        # CSV bulk import
│   │   └── reports.js        # Reports + Excel/PDF export
│   └── utils/
│       └── errors.js         # Custom error classes
└── static/                   # Pre-built React frontend
    ├── index.html
    └── assets/
```

---

## Troubleshooting

### 502 Bad Gateway
- Ensure Node.js is enabled for your site in the hosting panel
- Check that `.env` exists with correct database credentials
- Check `iisnode/` folder for error logs
- Verify `npm install --production` completed successfully

### Cannot connect to database
- Verify DB host, username, password in `.env`
- Ensure the database user has permissions on the database
- Check if MySQL is accessible from your site (some hosts use a different host than `localhost`)

### Login not working
- Verify the database was imported correctly (`users` table should have 7 rows)
- Password for all demo users is `Admin@123`

### Static files not loading (blank page)
- Ensure `static/` folder with `index.html` and `assets/` exists at the site root
- Check that `web.config` is at the site root

### CORS errors
- Update `ALLOWED_ORIGINS` in `.env` to include your exact site URL
- Include both `http://` and `https://` versions

---

## Support

For issues or questions, contact the development team.
