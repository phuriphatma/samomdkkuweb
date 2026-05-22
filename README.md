# MDKKU SAMO - Student Portal

Welcome to the official Web Portal for the Medical Student Union of Khon Kaen University (MDKKU SAMO). This portal serves as a centralized hub for student announcements, public relations (PR) workflows, and the Vital Sound grievance/ticketing system.

## 🌟 Key Features

*   **Announcements & News Board:** Read the latest updates from the student union and create new announcements via a built-in Rich Text Editor (Quill.js).
*   **PR Submission System:** A robust form for student clubs and departments to submit PR requests (Instagram/Facebook). Includes an interactive timeline, status tracking, and Google Identity Services for user authentication.
*   **Vital Sound System:** An anonymous ticketing system for students to voice their concerns. Features a direct pipeline to specific departments, dynamic routing, and interactive chat remarks.
*   **Staff Dashboards:** Dedicated Admin tab (role-gated) hosting the PR Kanban dashboard with status columns and department filter, plus the VS Staff dashboard with a department/role switcher.
*   **Global Authentication:** One sign-in modal (username/password + Google) at the top right of the navbar. Roles: regular user, PR staff (`samomdkkupr`), VS staff (`samomdkkuvssound`), and dev (`samomdkkudev`). Dev role unlocks features like silent Discord notifications.

## 🏗 Architecture & Tech Stack

This project recently underwent a major architectural refactor to move away from a monolithic codebase into a highly maintainable, modular structure.

*   **Core:** HTML5, CSS3 (Vanilla), ES6+ JavaScript
*   **Build Tool:** [Vite](https://vitejs.dev/) (Fast development server and optimized production builds)
*   **Styling:** Bootstrap 5 (CSS framework) + Custom CSS Modules
*   **Backend / API:** Google Apps Script (`.gs` files acting as serverless Webhooks/APIs)
*   **Libraries:** Quill.js (Rich Text), SweetAlert2 (Popups), Google Identity Services (OAuth)

### Folder Structure

```text
samomdkkuweb/
├── index.html            # Main entry point (Routing shell)
├── package.json          # Project dependencies & scripts
├── vite.config.js        # Vite configuration (Custom HTML Partials plugin)
├── src/
│   ├── html/             # Extracted HTML components (Partials)
│   │   ├── navbar.html
│   │   ├── tab-home.html
│   │   ├── tab-announcements.html
│   │   ├── tab-creator.html
│   │   ├── tab-pr.html
│   │   ├── tab-vitalsound.html
│   │   ├── tab-admin.html         # Role-gated admin dashboard
│   │   ├── tab-about.html         # Team / Vision / Mission demo pages
│   │   ├── modal-signin.html      # Global auth modal
│   │   └── modal-*.html           # Other modals (announcement, PR/VS staff, agents)
│   ├── css/              # Modularized CSS
│   │   ├── main.css      # Central stylesheet (imports others)
│   │   ├── cards.css
│   │   ├── forms.css
│   │   └── ...
│   └── js/               # Decoupled JavaScript modules
│       ├── main.js       # Main module bundler
│       ├── pr-form.js    # PR logic
│       ├── vs-form.js    # Vital Sound logic
│       ├── auth.js       # Authentication
│       └── ...
└── dist/                 # Production build output (Generated via Vite)
```

## 🚀 Getting Started

To run this project locally, you will need [Node.js](https://nodejs.org/) installed on your machine.

### 1. Installation
Clone the repository and install the dependencies:
```bash
npm install
```

### 2. Local Development Server
Start the Vite development server with hot-module replacement (HMR):
```bash
npm run dev
```
Navigate to `http://localhost:5174` in your browser. *(Note: To test Google Login locally, ensure `http://localhost:5174` is added to your Google Cloud Console OAuth Authorized JavaScript origins).*

### 3. Building for Production
To bundle and minify the project for production deployment:
```bash
npm run build
```
This command will stitch all HTML partials, transpile/minify the JavaScript, and output the optimized application into the `dist/` directory.

## ☁️ Deployment

The application consists of static files (HTML, CSS, JS). You can deploy the contents of the `dist/` folder to any static hosting provider, such as:
*   Cloudflare Pages
*   GitHub Pages
*   Vercel
*   Netlify

*Note: The backend logic relies on Google Apps Script webhooks. Ensure the frontend `fetch` endpoints are pointing to the correct active GAS deployment URL.*

## 🤝 Contributing
1.  All visual components (Tabs, Modals) must be created as partials in `src/html/` and imported into `index.html` via `<include src="..." />`.
2.  Do not place inline CSS or JS inside `index.html`. Add them to their respective folders in `src/css/` and `src/js/`.
3.  Any newly created functions that are triggered by HTML attributes (like `onclick`) must be exposed to the `window` object in `src/js/main.js`.
