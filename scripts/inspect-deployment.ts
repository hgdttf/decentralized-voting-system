
import { ethers } from "hardhat";
import type { InterfaceAbi } from "ethers";

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

interface ContractArtifact {
    abi: InterfaceAbi;
}

async function main(): Promise<void> {
    console.log("\n========== DEPLOYMENT DIAGNOSTICS ==========\n");

    // 1. Load deployment information.
    const deploymentPath = resolve(
        __dirname,
        "../deployments/localhost.json"
    );

    const deployment: DeploymentFile = JSON.parse(
        readFileSync(deploymentPath, "utf-8")
    );

    const address = deployment.contracts.voting;

    console.log("Configured network:", deployment.network);
    console.log("Configured chain ID:", deployment.chainId);

    // 2. Check the connected blockchain network.
    const network = await ethers.provider.getNetwork();

    console.log("\nConnected chain ID:", network.chainId.toString());

    if (network.chainId.toString() !== deployment.chainId) {
        throw new Error(
            "Connected network does not match the deployment configuration."
        );
    }

    // 3. Check deployed contract bytecode.
    console.log("\nContract address:", address);

    const code = await ethers.provider.getCode(address);

    const contractExists = code !== "0x";

    console.log("Contract bytecode exists:", contractExists);
    console.log(
        "Deployed bytecode size:",
        contractExists ? (code.length - 2) / 2 : 0,
        "bytes"
    );

    if (!contractExists) {
        throw new Error(
            "No contract bytecode exists at the configured Voting address."
        );
    }

    // 4. Load the compiled Voting artifact.
    const artifactPath = resolve(
        __dirname,
        "../artifacts/contracts/Voting.sol/Voting.json"
    );

    const artifact: ContractArtifact = JSON.parse(
        readFileSync(artifactPath, "utf-8")
    );

    // 5. Create a read-only contract instance.
    const voting = new ethers.Contract(
        address,
        artifact.abi,
        ethers.provider
    );

    // 6. Display function selectors from the compiled ABI.
    const functionNames: string[] = [
        "getElection",
        "getElectionPublicKey",
        "setElectionPublicKey"
    ];

    console.log("\n========== ABI FUNCTION SELECTORS ==========\n");

    for (const name of functionNames) {
        const fragment = voting.interface.getFunction(name);

        if (fragment === null) {
            console.log(`${name}: NOT FOUND IN ABI`);
        } else {
            console.log(`${name}: ${fragment.selector}`);
        }
    }

    // 7. Test the existing Election 1 getter.
    console.log("\n========== ON-CHAIN FUNCTION CHECKS ==========\n");

    try {
        const getElection = voting.getFunction("getElection");
        const election = await getElection(1);

        console.log("getElection: SUCCESS");
        console.log("Election ID: 1");
        console.log("Election title:", election[0]);
        console.log("Administrator:", election[1]);
        console.log("Start time:", election[2].toString());
        console.log("End time:", election[3].toString());
        console.log("Registered voters:", election[6].toString());
        console.log("Accepted ballots:", election[7].toString());
        console.log("Election status:", election[9].toString());
    } catch (error) {
        console.log("getElection: FAILED");

        console.log(
            error instanceof Error ? error.message : String(error)
        );
    }

    // 8. Test the public election key getter.
    try {
        const getElectionPublicKey = voting.getFunction(
            "getElectionPublicKey"
        );

        const publicKey = await getElectionPublicKey(1);

        console.log("\ngetElectionPublicKey: SUCCESS");
        console.log("Published public key:", publicKey);
    } catch (error) {
        console.log("\ngetElectionPublicKey: FAILED");

        console.log(
            error instanceof Error ? error.message : String(error)
        );
    }

    // 9. Do not execute the setter during diagnostics.
    console.log("\nsetElectionPublicKey: NOT EXECUTED");
    console.log("Reason: This function modifies blockchain state.");

    console.log("\n========== DIAGNOSTICS COMPLETED ==========\n");
}

main().catch((error: unknown) => {
    console.error("\nDiagnostic execution failed:");

    console.error(
        error instanceof Error ? error.message : String(error)
    );

    process.exitCode = 1;
});
