# Team Capacity Planner - Dependencies & Setup Guide

## Project Type
This is a **Frontend Web Application** built with React and TypeScript.
- **NO Python dependencies** - this is a Node.js/npm project
- **NO requirements.txt** - uses `package.json` instead

---

## Environment Setup

### Prerequisites
- **Node.js**: v18.0.0 or higher (recommended: v20+)
- **npm**: v9.0.0 or higher
- **Git**: For version control

### Installation

#### 1. Clone/Download Repository
```bash
cd /path/to/team-capacity-planner
```

#### 2. Install Dependencies
```bash
npm install
```

This reads `package.json` and installs all required packages to `node_modules/`

#### 3. Verify Installation
```bash
npm list
```

---

## Production Dependencies

### Core Framework
| Package | Version | Purpose |
|---------|---------|---------|
| **react** | ^19.2.0 | UI component library |
| **react-dom** | ^19.2.0 | React DOM rendering |
| **zustand** | ^5.0.9 | State management (lightweight alternative to Redux) |

### UI & Styling
| Package | Version | Purpose |
|---------|---------|---------|
| **lucide-react** | ^0.562.0 | Icon library (600+ SVG icons) |
| **tailwindcss** | ^3.4.19 | Utility-first CSS framework (Installed as devDependency) |

### Utilities
| Package | Version | Purpose |
|---------|---------|---------|
| **date-fns** | ^4.1.0 | Date manipulation and formatting utilities |

---

## Development Dependencies

### Build Tools
| Package | Version | Purpose |
|---------|---------|---------|
| **vite** | ^7.2.4 | Fast build tool and dev server |
| **@vitejs/plugin-react** | ^5.1.1 | React support for Vite |

### TypeScript
| Package | Version | Purpose |
|---------|---------|---------|
| **typescript** | ~5.9.3 | TypeScript compiler and type checking |
| **@types/react** | ^19.2.5 | Type definitions for React |
| **@types/react-dom** | ^19.2.3 | Type definitions for React DOM |
| **@types/node** | ^24.10.1 | Type definitions for Node.js |

### Code Quality
| Package | Version | Purpose |
|---------|---------|---------|
| **eslint** | ^9.39.1 | Code linting and style enforcement |
| **@eslint/js** | ^9.39.1 | ESLint default configurations |
| **eslint-plugin-react-hooks** | ^7.0.1 | ESLint rules for React Hooks |
| **eslint-plugin-react-refresh** | ^0.4.24 | ESLint rules for React Fast Refresh |
| **typescript-eslint** | ^8.46.4 | TypeScript support for ESLint |
| **globals** | ^16.5.0 | Global variable definitions |

### CSS Processing
| Package | Version | Purpose |
|---------|---------|---------|
| **tailwindcss** | ^3.4.19 | Utility-first CSS framework |
| **postcss** | ^8.5.6 | CSS transformation plugin system |
| **autoprefixer** | ^10.4.23 | CSS vendor prefix automation |

---

## Development Commands

### Start Development Server
```bash
npm run dev
```
- Starts Vite dev server on `http://localhost:5173`
- Hot Module Reloading (HMR) enabled
- Access from network: `http://<your-ip>:5173`

### Build for Production
```bash
npm run build
```
- Runs TypeScript type checking (`tsc -b`)
- Bundles code with Vite
- Optimizes assets
- Output in `dist/` directory

### Preview Production Build
```bash
npm run preview
```
- Serves the `dist/` folder locally
- Useful for testing production build before deployment

### Lint Code
```bash
npm run lint
```
- Checks code style and quality
- Reports errors and warnings
- Uses ESLint configuration

---

## npm Script Reference

Defined in `package.json`:

```json
{
  "scripts": {
    "dev": "vite",                    // Development server
    "build": "tsc -b && vite build",  // TypeScript check + Production build
    "lint": "eslint .",               // Code linting
    "preview": "vite preview"         // Preview production build
  }
}
```

---

## Dependency Tree

```
team-capacity-planner
├── PRODUCTION DEPENDENCIES
│   ├── react (19.2.0)
│   │   └── react-dom (19.2.0)
│   ├── zustand (5.0.9)
│   ├── lucide-react (0.562.0)
│   └── date-fns (4.1.0)
│
└── DEVELOPMENT DEPENDENCIES
    ├── Build & Development
    │   ├── vite (7.2.4)
    │   │   └── @vitejs/plugin-react (5.1.1)
    │   └── typescript (5.9.3)
    │       ├── @types/react (19.2.5)
    │       ├── @types/react-dom (19.2.3)
    │       └── @types/node (24.10.1)
    │
    ├── Code Quality
    │   ├── eslint (9.39.1)
    │   │   ├── @eslint/js (9.39.1)
    │   │   ├── eslint-plugin-react-hooks (7.0.1)
    │   │   ├── eslint-plugin-react-refresh (0.4.24)
    │   │   ├── typescript-eslint (8.46.4)
    │   │   └── globals (16.5.0)
    │   │
    │   └── Styling
    │       ├── tailwindcss (3.4.19)
    │       ├── postcss (8.5.6)
    │       └── autoprefixer (10.4.23)
```

---

## Configuration Files

### `package.json`
- Defines project metadata
- Lists all dependencies with versions
- Contains npm scripts
- Specifies Node module type as "module" (ES modules)

### `tsconfig.json`
- TypeScript compiler configuration
- Sets strict type checking
- Defines module resolution
- Specifies JSX handling (React)

### `vite.config.ts`
- Vite build configuration
- Configures React plugin
- Sets build output directory
- Defines dev server options

### `tailwind.config.js`
- Tailwind CSS configuration
- Custom theme extensions
- Plugin configuration
- Content file paths

### `postcss.config.js`
- PostCSS plugin configuration
- Includes Tailwind CSS and Autoprefixer

### `.eslintrc.js`
- ESLint configuration
- Code style rules
- Plugin settings
- File patterns to lint

---

## Troubleshooting

### Issue: Dependencies not installed
```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install
```

### Issue: Port 5173 already in use
```bash
# Use custom port
npm run dev -- --port 3000
```

### Issue: TypeScript errors
```bash
# Check for type errors
npx tsc --noEmit

# See which package has type issues
npm list --depth=3
```

### Issue: ESLint errors prevent build
```bash
# Check lint errors
npm run lint

# Some errors can be auto-fixed
npx eslint . --fix
```

### Issue: Memory issues during build
```bash
# Increase Node memory limit
NODE_OPTIONS=--max_old_space_size=4096 npm run build
```

---

## Production Deployment

### Build Optimization
The build process automatically:
- Minifies JavaScript and CSS
- Tree-shakes unused code
- Splits code into chunks
- Compresses assets
- Generates source maps

### Deployment Steps
1. Run `npm run build` locally
2. Verify output in `dist/` directory
3. Deploy `dist/` folder to web server
4. No Node.js runtime needed for static hosting

### Static Hosting Options
- Vercel
- Netlify
- GitHub Pages
- AWS S3 + CloudFront
- Nginx
- Apache
- Any static file server

---

## Updates & Maintenance

### Check for updates
```bash
npm outdated
```

### Update all dependencies
```bash
npm update
```

### Update specific package
```bash
npm install package-name@latest
```

### Update major versions (breaking changes)
```bash
npm install package-name@^X.0.0
```

### Security audit
```bash
npm audit
npm audit fix
```

---

## Notes

- **No Python required**: This is a pure JavaScript/TypeScript frontend project
- **No requirements.txt**: Python requirements files are not applicable
- **Use package.json**: All dependency management is via npm and package.json
- **Lock file included**: `package-lock.json` ensures reproducible installs
- **Node modules**: Can be recreated with `npm install` - safe to delete locally

---

## Quick Reference

| Command | Purpose |
|---------|---------|
| `npm install` | Install all dependencies |
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build |
| `npm run lint` | Check code quality |
| `npm update` | Update all packages |
| `npm audit` | Check security vulnerabilities |
| `npm list` | Show dependency tree |

---

*Last Updated: December 2025*
*Node.js Version Tested: v20.10+*
*npm Version Tested: v10.2+*
