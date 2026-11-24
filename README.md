# Decentralized Voting System

A privacy-preserving decentralized voting system built with Solidity,
Semaphore zero-knowledge proofs, Hardhat, and a FastAPI backend.

## Architecture

- **Smart contracts:** Solidity contracts deployed using Hardhat.
- **Voter privacy:** Semaphore-based group membership and zero-knowledge proofs.
- **Backend:** FastAPI exposes election, voter registration, ballot, and result APIs.
- **Blockchain bridge:** A controlled TypeScript bridge executes approved
  blockchain operations through Hardhat.
- **Frontend:** The API is designed to be consumed by a separate web frontend.

## Prerequisites

- Node.js 22
- Yarn 4
- Python 3.11 or later
- Git

## 1. Clone and install dependencies

```bash
git clone https://github.com/hgdttf/decentralized-voting-system.git
cd decentralized-voting-system

corepack enable
yarn install
```

## 2. Start the local blockchain

Open Terminal 1:

```bash
yarn dev
```

This starts a local Hardhat node at:

`http://127.0.0.1:8545`

Keep this terminal running.

## 3. Deploy the contracts

Open Terminal 2, from the project root:

```bash
yarn deploy:local
```

The deployment task deploys the required contracts and generates:

`deployments/localhost.json`

This file contains addresses specific to your local Hardhat node.
It is intentionally excluded from Git. Each developer must deploy locally.

## 4. Configure the backend

From the project root:

```bash
cd backend
cp .env.example .env
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Edit `backend/.env` and replace all three security placeholders with
independently generated secret values:

- `ADMIN_API_TOKEN`
- `IDENTITY_VAULT_PASSPHRASE`
- `ELECTION_KEY_PASSPHRASE`

Do not commit or share the real `.env` file.

## 5. Start the API

From the `backend` directory, with its virtual environment activated:

```bash
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

API base URL:

`http://127.0.0.1:8000/api/v1`

Interactive API documentation:

`http://127.0.0.1:8000/docs`

## 6. Frontend integration

The backend allows these local frontend origins by default:

- `http://localhost:3000`
- `http://localhost:5173`

Update `CORS_ORIGINS` in `backend/.env` if your frontend uses another origin.

Administrative write operations require:

`Authorization: Bearer <ADMIN_API_TOKEN>`

Never expose the administrative token in frontend source code.
Requests requiring administrative privileges must be made through a
trusted backend or protected server-side layer.

## 7. Run tests

From the project root:

```bash
yarn test
npx tsc --noEmit
```

For backend tests:

```bash
cd backend
source .venv/bin/activate
pytest -q
```

## Important security notes

- Never commit `.env` files, private keys, voter identity backups,
  election-key backups, or passphrases.
- Keep voter identity and election-key backups secure and separate from
  the source repository.
- Local Hardhat accounts and deployment addresses are for development only.
- A fresh local deployment has different contract addresses.
- Do not use this development configuration for a live election without
  a separate security review, deployment plan, and operational controls.
