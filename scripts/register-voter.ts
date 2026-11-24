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
    console.log("\n========== REGISTER VOTER ==========\n");

    const electionIdInput = process.env.ELECTION_ID;
    const commitmentInput = process.env.VOTER_COMMITMENT;

    if (!electionIdInput || !/^[1-9][0-9]*$/.test(electionIdInput)) {
        throw new Error("A valid ELECTION_ID is required.");
    }

    if (!commitmentInput || !/^[0-9]+$/.test(commitmentInput)) {
        throw new Error("A valid decimal VOTER_COMMITMENT is required.");
    }

    const electionId = BigInt(electionIdInput);
    const commitment = BigInt(commitmentInput);

    if (commitment <= 0n || commitment >= (1n << 256n)) {
        throw new Error("Commitment is outside the valid uint256 range.");
    }

    const deploymentPath = resolve(
        __dirname,
        "../deployments/localhost.json"
    );

    const deployment: DeploymentFile = JSON.parse(
        readFileSync(deploymentPath, "utf-8")
    );

    if (
        deployment.network !== "localhost" ||
        deployment.chainId !== "1337"
    ) {
        throw new Error("Incorrect deployment configuration.");
    }

    const network = await ethers.provider.getNetwork();

    if (network.chainId !== 1337n) {
        throw new Error("Connected network is not chain ID 1337.");
    }

    const [admin] = await ethers.getSigners();

    const votingCode = await ethers.provider.getCode(
        deployment.contracts.voting
    );

    if (votingCode === "0x") {
        throw new Error("Voting contract is not deployed.");
    }

    const voting = await ethers.getContractAt(
        "Voting",
        deployment.contracts.voting,
        admin
    );

    const nextElectionId = await voting.nextElectionId();

    if (electionId >= nextElectionId) {
        throw new Error("Election does not exist.");
    }

    const election = await voting.getElection(electionId);

    const electionAdmin = election[1] as string;
    const electionStatus = BigInt(election[9]);

    if (electionAdmin.toLowerCase() !== admin.address.toLowerCase()) {
        throw new Error("Connected signer is not the election administrator.");
    }

    if (electionStatus !== 0n) {
        throw new Error("Election is not in Registration status.");
    }

    const alreadyRegistered = await voting.registeredCommitments(
        electionId,
        commitment
    );

    if (alreadyRegistered) {
        console.log("Commitment is already registered. No transaction sent.");
        return;
    }

    console.log("Network:", network.chainId.toString());
    console.log("Administrator:", admin.address);
    console.log("Election ID:", electionId.toString());
    console.log("Voting contract:", deployment.contracts.voting);
    console.log("Registering commitment...");

    const transaction = await voting.registerVoter(
        electionId,
        commitment
    );

    console.log("Transaction submitted:", transaction.hash);

    const receipt = await transaction.wait();

    if (!receipt || receipt.status !== 1) {
        throw new Error("Registration transaction failed.");
    }

    const verified = await voting.registeredCommitments(
        electionId,
        commitment
    );

    if (!verified) {
        throw new Error("On-chain registration verification failed.");
    }

    const updatedElection = await voting.getElection(electionId);

    console.log("\nRegistration transaction confirmed.");
    console.log("Block number:", receipt.blockNumber);
    console.log("On-chain commitment verification: PASSED");
    console.log(
        "Registered voter count:",
        updatedElection[6].toString()
    );
    console.log("\nVOTER REGISTRATION PASSED.");
}

main().catch((error: unknown) => {
    console.error("\nVOTER REGISTRATION FAILED.");

    if (error instanceof Error) {
        console.error(error.message);
    } else {
        console.error("An unexpected error occurred.");
    }

    process.exitCode = 1;
});
