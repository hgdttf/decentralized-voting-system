
import { ethers } from "hardhat";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface DeploymentFile {
    network: string;
    chainId: string;
    contracts: {
        voting: string;
        semaphore: string;
    };
}

async function main(): Promise<void> {
    console.log("\n========== CREATE ELECTION ==========\n");

    // 1. Load deployment configuration.
    const deploymentPath = resolve(
        __dirname,
        "../deployments/localhost.json"
    );

    const deployment: DeploymentFile = JSON.parse(
        readFileSync(deploymentPath, "utf-8")
    );

    if (deployment.network !== "localhost") {
        throw new Error("Incorrect deployment network.");
    }

    // 2. Verify the blockchain network.
    const network = await ethers.provider.getNetwork();

    if (network.chainId !== 1337n) {
        throw new Error(
            `Expected chain ID 1337, received ${network.chainId}`
        );
    }

    if (deployment.chainId !== network.chainId.toString()) {
        throw new Error("Deployment chain ID mismatch.");
    }

    // 3. Connect using the administrator account.
    const [admin] = await ethers.getSigners();

    console.log("Administrator:", admin.address);
    console.log("Chain ID:", network.chainId.toString());
    console.log("Semaphore:", deployment.contracts.semaphore);
    console.log("Voting contract:", deployment.contracts.voting);

    // 4. Verify deployed Voting bytecode.
    const bytecode = await ethers.provider.getCode(
        deployment.contracts.voting
    );

    if (bytecode === "0x") {
        throw new Error("Voting contract not found.");
    }

    // 5. Connect to the deployed Voting contract.
    const voting = await ethers.getContractAt(
        "Voting",
        deployment.contracts.voting,
        admin
    );

    // 6. Retrieve the next available election ID.
    const electionId = await voting.nextElectionId();

    if (electionId < 1n) {
        throw new Error(
            `Invalid next election ID: ${electionId}`
        );
    }

    console.log("Next election ID:", electionId.toString());

    // 7. Calculate a safe election schedule.
    const latestBlock = await ethers.provider.getBlock("latest");

    if (!latestBlock) {
        throw new Error("Unable to retrieve the latest block.");
    }

    const localTimestamp = Math.floor(Date.now() / 1000);

    // Use the later timestamp to account for clock differences.
    const currentTimestamp = Math.max(
        latestBlock.timestamp,
        localTimestamp
    );

    // Allow 30 minutes for registration before voting starts.
    const startTime = currentTimestamp + 30 * 60;

    // Keep the voting window open for 60 minutes.
    const endTime = startTime + 60 * 60;

    if (
        startTime <= currentTimestamp ||
        endTime <= startTime
    ) {
        throw new Error("Invalid election schedule.");
    }

    const title = `Demonstration Election ${electionId}`;

    console.log("\nElection title:", title);

    console.log(
        "Latest blockchain time:",
        new Date(latestBlock.timestamp * 1000).toISOString()
    );

    console.log(
        "Local system time:",
        new Date(localTimestamp * 1000).toISOString()
    );

    console.log(
        "Scheduled voting start:",
        new Date(startTime * 1000).toISOString()
    );

    console.log(
        "Scheduled voting deadline:",
        new Date(endTime * 1000).toISOString()
    );

    // 8. Create the election.
    console.log("\nCreating election...");

    const createTx = await voting.createElection(
        title,
        startTime,
        endTime
    );

    console.log("Creation transaction:", createTx.hash);

    const createReceipt = await createTx.wait();

    if (!createReceipt || createReceipt.status !== 1) {
        throw new Error("Election creation transaction failed.");
    }

    console.log("Election creation confirmed.");

    // 9. Add candidates.
    const candidateNames = [
        "Candidate A",
        "Candidate B"
    ];

    for (const candidateName of candidateNames) {
        const candidateTx = await voting.addCandidate(
            electionId,
            candidateName
        );

        const candidateReceipt = await candidateTx.wait();

        if (!candidateReceipt || candidateReceipt.status !== 1) {
            throw new Error(
                `Failed to add candidate: ${candidateName}`
            );
        }

        console.log("Candidate added:", candidateName);
    }

    // 10. Verify election state on-chain.
    const election = await voting.getElection(electionId);
    const candidates = await voting.getCandidates(electionId);
    const nextElectionId = await voting.nextElectionId();

    if (nextElectionId !== electionId + 1n) {
        throw new Error(
            "Election ID progression verification failed."
        );
    }

    if (candidates.length !== candidateNames.length) {
        throw new Error(
            "Candidate count verification failed."
        );
    }

    if (election[2] !== BigInt(startTime)) {
        throw new Error("Election start-time verification failed.");
    }

    if (election[3] !== BigInt(endTime)) {
        throw new Error("Election end-time verification failed.");
    }

    console.log("\n========== ELECTION CREATED ==========");
    console.log("Election ID:", electionId.toString());
    console.log("Title:", election[0]);
    console.log("Administrator:", election[1]);
    console.log("Start time:", election[2].toString());
    console.log("End time:", election[3].toString());
    console.log("Semaphore group ID:", election[4].toString());
    console.log("Semaphore scope:", election[5].toString());
    console.log("Registered voters:", election[6].toString());
    console.log("Accepted ballots:", election[7].toString());
    console.log("Status:", election[9].toString());

    console.log("\nCandidates:");

    candidates.forEach(
        (candidate: { name: string }, index: number) => {
            console.log(`${index + 1}. ${candidate.name}`);
        }
    );

    console.log(
        "\nNext available election ID:",
        nextElectionId.toString()
    );

    console.log("\n======================================\n");
}

main().catch((error: unknown) => {
    console.error("\nElection creation failed:");

    console.error(
        error instanceof Error ? error.message : String(error)
    );

    process.exitCode = 1;
});
