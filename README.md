# Fix My Campus — Full-Stack Project

Campus issue reporting and resolution system using Node.js, Express, SQLite, JWT, bcrypt and a responsive HTML/CSS/JavaScript frontend.

## Requirements

- Node.js 22 LTS recommended
- npm

## Run locally

Open a terminal in this folder and run:

```bash
npm install
npm start
```

Open:

```text
http://localhost:5000
```

The server also supports the hosting-provided `PORT` environment variable.

## Demo admin

Email: `admin@campus.local`
Password: `Admin@123`

Students can create accounts from the Register tab.

## Important

- `node_modules/` is not included; run `npm install`.
- `data/` and `uploads/` are local runtime folders and are ignored by Git.
- Set a strong `JWT_SECRET` environment variable for any real deployment.
- The demo admin password is for testing only.

## Deploy to Render

1. Push this folder to GitHub.
2. Create a Render Web Service from the repository.
3. Build command: `npm install`
4. Start command: `npm start`
5. Add `JWT_SECRET` as an environment variable.

For a production deployment with persistent data, migrate SQLite/local uploads to a managed database and persistent/object storage.

## Main API

- POST `/api/auth/register`
- POST `/api/auth/login`
- GET `/api/auth/me`
- GET `/api/health`
- GET `/api/dashboard`
- GET `/api/issues`
- GET `/api/issues/:id`
- POST `/api/issues`
- PATCH `/api/issues/:id`
- POST `/api/issues/:id/comments`
- GET `/api/users/staff`
- POST `/api/users/staff`


## AI Features

The AI edition includes:
- AI issue category and priority suggestions
- AI-generated complaint summary and recommended action
- AI Campus Assistant chat
- Local fallback AI logic that works without an API key
- Optional OpenAI Responses API integration

### Enable real AI responses

Keep the API key on the server only. Do NOT put it in `public/app.js` and do NOT commit it to GitHub.

Windows CMD:
```cmd
set OPENAI_API_KEY=your_api_key_here
npm start
```

PowerShell:
```powershell
$env:OPENAI_API_KEY="your_api_key_here"
npm start
```

Git Bash:
```bash
export OPENAI_API_KEY="your_api_key_here"
npm start
```

Optional model:
```text
OPENAI_MODEL=gpt-5.6-luna
```

If `OPENAI_API_KEY` is not set, the application still provides local rule-based AI suggestions and a local campus assistant.

The OpenAI API uses the Responses API for text generation. See the official OpenAI API documentation for current setup and model information.


## Important after updating
If you previously used an older version of Fix My Campus in this browser, clear the old login token:
- Open the website
- Press F12 -> Application -> Local Storage -> localhost:5000
- Delete the old `fmc_token` entry
- Refresh and log in again

Or simply use an Incognito window for the first test.

The server now validates JWT users against the database before protected routes run, preventing `Cannot read properties of undefined (reading 'id')`.
