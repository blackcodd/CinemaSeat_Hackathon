# CinemaSeat Hackathon

CinemaSeat is a high-concurrency movie seat reservation and payment system built with Node.js (Express), PostgreSQL, and Docker.

## Project Structure

```text
cinemaseat/
├── backend/          # Express API & DB Migrations (Person 1 + Person 2)
│   ├── src/
│   │   ├── index.js
│   │   └── db/
│   │       └── schema.sql
│   ├── package.json
│   ├── .env.example
│   └── Dockerfile
├── frontend/         # Web Frontend Client (Person 3)
│   ├── src/
│   │   └── index.html
│   ├── package.json
│   └── Dockerfile
├── docs/
│   └── API_CONTRACT.md
├── docker-compose.yml
├── README.md
└── DECISIONS.md
```

## Getting Started

Start all services (PostgreSQL, Mock Gateway, Backend, Frontend) with Docker Compose:

```bash
docker-compose up --build
```

### Port Mappings
- **Frontend:** `http://localhost:3000`
- **Backend:** `http://localhost:4000`
- **Mock Gateway:** `http://localhost:9000`
- **PostgreSQL:** `localhost:5432`

## API Contract
Detailed endpoint definitions are available in [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md).
