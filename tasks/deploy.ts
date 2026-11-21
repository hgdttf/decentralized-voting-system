
import { task, types } from "hardhat/config";

// Existing task: deploy the Feedback contract.
// Preserved to maintain compatibility with Feedback.ts tests.
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

// New task: deploy the Voting contract independently.
task("deploy:voting", "Deploy the Voting contract")
    .addOptionalParam(
        "semaphore",
        "Semaphore contract address",
        undefined,
        types.string
    )
    .addOptionalParam(
        "logs",
        "Print deployment information",
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

        const VotingFactory = await ethers.getContractFactory("Voting");

        const votingContract = await VotingFactory.deploy(
            semaphoreAddress
        );

        await votingContract.waitForDeployment();

        if (logs) {
            console.info("Voting contract deployed successfully.");
            console.info(`Semaphore address: ${semaphoreAddress}`);
            console.info(
                `Voting address: ${await votingContract.getAddress()}`
            );
        }

        return votingContract;
    });
