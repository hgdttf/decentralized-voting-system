
from app.services.blockchain import BlockchainService


def test_blockchain_connection():
    """Verify RPC connectivity and deployment initialization."""

    service = BlockchainService()
    service.connect()

    assert service.w3.is_connected()
    assert service.chain_id == 1337

    assert service.voting_address is not None
    assert service.semaphore_address is not None
    assert service.voting_contract is not None

    print("\n========== BLOCKCHAIN CONNECTION ==========")
    print("RPC Connected:", service.w3.is_connected())
    print("Chain ID:", service.chain_id)
    print("Voting Address:", service.voting_address)
    print("Semaphore Address:", service.semaphore_address)
    print("Contract Initialized:", service.voting_contract is not None)
    print("===========================================")


def test_contract_interface_is_initialized():
    """Verify that the Voting contract exposes expected functions."""

    service = BlockchainService()
    service.connect()

    contract = service.get_voting_contract()

    assert contract.address == service.voting_address

    function_names = {
        item.get("name")
        for item in contract.abi
        if item.get("type") == "function"
    }

    expected_functions = {
        "createElection",
        "submitBallot",
        "getElection",
        "getResults",
        "registerVoter",
        "addCandidate",
        "startVoting",
        "closeElection",
        "finalizeElection",
    }

    missing_functions = expected_functions - function_names

    assert not missing_functions, (
        f"Missing contract functions: {missing_functions}"
    )

    print("\n========== CONTRACT ABI ==========")
    print("Contract Address:", contract.address)
    print("Verified Functions:")

    for function_name in sorted(expected_functions):
        print(" -", function_name)

    print("==================================")


def test_voting_contract_has_deployed_bytecode():
    """Verify that the Voting contract exists on the local blockchain."""

    service = BlockchainService()
    service.connect()

    bytecode = service.w3.eth.get_code(service.voting_address)

    assert len(bytecode) > 0

    print("\n========== VOTING CONTRACT ==========")
    print("Voting Address:", service.voting_address)
    print("Bytecode Size:", len(bytecode), "bytes")
    print("====================================")


def test_semaphore_contract_has_deployed_bytecode():
    """Verify that the Semaphore contract exists on the local blockchain."""

    service = BlockchainService()
    service.connect()

    bytecode = service.w3.eth.get_code(service.semaphore_address)

    assert len(bytecode) > 0

    print("\n========== SEMAPHORE CONTRACT ==========")
    print("Semaphore Address:", service.semaphore_address)
    print("Bytecode Size:", len(bytecode), "bytes")
    print("=======================================")
