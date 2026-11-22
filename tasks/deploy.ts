
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { task, types } from "hardhat/config";

// Existing Feedback deployment task.
// Preserved for compatibility with existing tests.

task("deploy", "Deploy a Feedback contract")
    .addOptionalParam(
        "semaphore",
        "Semaphore contract address",
        undefined,
        types.string
    )
    .addOptionalParam(
        "logs",
        "Print the logs",
        true,
        types.boolean
    )
    .setAction(async ({ logs, semaphore }, { ethers, run }) => {
        let semaphoreAddress = semaphore;

        if (!semaphoreAddress) {
            const { semaphore: semaphoreContract } = await run(
                "deploy:semaphore",
                { logs }
            );

            semaphoreAddress = await semaphoreContract.getAddress();
        }

        const FeedbackFactory = await ethers.getContractFactory("Feedback");

        const feedbackContract = await FeedbackFactory.deploy(
            semaphoreAddress
        );

        await feedbackContract.waitForDeployment();

        if (logs) {
            console.info(
                `Feedback contract has been deployed to: ${await feedbackContract.getAddress()}`
            );
        }

        return feedbackContract;
    });

// Voting deployment task.
// Deploys Semaphore and Voting, then saves deployment addresses.

task("deploy:voting", "Deploy the Voting contract")
    .addOptionalParam(
        "semaphore",
        "Existing Semaphore contract address",
        undefined,
        types.string
    )
    .addOptionalParam(
        "logs",
        "Print deployment information",
        true,
        types.boolean
    )
    .setAction(async ({ logs, semaphore }, { ethers, run, network }) => {
        let semaphoreAddress = semaphore;

        if (!semaphoreAddress) {
            const { semaphore: semaphoreContract } = await run(
                "deploy:semaphore",
                { logs }
            );

            semaphoreAddress = await semaphoreContract.getAddress();
        }

        const VotingFactory = await ethers.getContractFactory("Voting");

        const votingContract = await VotingFactory.deploy(
            semaphoreAddress
        );

        await votingContract.waitForDeployment();

        const votingAddress = await votingContract.getAddress();

        const networkInfo = await ethers.provider.getNetwork();

        const deployment = {
            schemaVersion: 1,
            network: network.name,
            chainId: networkInfo.chainId.toString(),
            deployedAt: new Date().toISOString(),
            contracts: {
                semaphore: semaphoreAddress,
                voting: votingAddress
            }
        };

        const deploymentDirectory = join(
            process.cwd(),
            "deployments"
        );

        await mkdir(deploymentDirectory, {
            recursive: true
        });

        const deploymentFile = join(
            deploymentDirectory,
            `${network.name}.json`
        );

        await writeFile(
            deploymentFile,
            `${JSON.stringify(deployment, null, 4)}\n`,
            "utf8"
        );

        if (logs) {
            console.info("\nVoting deployment successful.");
            console.info("----------------------------------");
            console.info(`Network: ${network.name}`);
            console.info(`Chain ID: ${networkInfo.chainId}`);
            console.info(`Semaphore: ${semaphoreAddress}`);
            console.info(`Voting: ${votingAddress}`);
            console.info(`Configuration: ${deploymentFile}`);
            console.info("----------------------------------\n");
        }

        return votingContract;
    });
