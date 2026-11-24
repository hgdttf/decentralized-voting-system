
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.blockchain import blockchain_service


class FakeCall:
    """Simulate a Web3 contract function call."""

    def __init__(self, result):
        self.result = result

    def call(self):
        return self.result


class FakeFunctions:
    """Simulate the read-only functions used by election endpoints."""

    def __init__(
        self,
        next_election_id=1,
        election=None,
        public_key=b"",
    ):
        self.next_election_id = next_election_id
        self.election = election
        self.public_key = public_key

    def nextElectionId(self):
        return FakeCall(self.next_election_id)

    def getElection(self, election_id):
        return FakeCall(self.election)

    def getElectionPublicKey(self, election_id):
        return FakeCall(self.public_key)


class FakeContract:
    """Simulate the Voting smart contract."""

    def __init__(
        self,
        next_election_id=1,
        election=None,
        public_key=b"",
    ):
        self.functions = FakeFunctions(
            next_election_id=next_election_id,
            election=election,
            public_key=public_key,
        )


@pytest.fixture
def client(monkeypatch):
    """Provide an API client with an empty fake contract."""

    fake_contract = FakeContract()

    monkeypatch.setattr(
        blockchain_service,
        "get_voting_contract",
        lambda: fake_contract,
    )

    return TestClient(app)


def create_populated_client(monkeypatch, public_key):
    """Create a test client containing one simulated election."""

    election = (
        "Demonstration Election",
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        1795450000,
        1795453600,
        12345,
        67890,
        3,
        0,
        0,
        0,
    )

    fake_contract = FakeContract(
        next_election_id=2,
        election=election,
        public_key=public_key,
    )

    monkeypatch.setattr(
        blockchain_service,
        "get_voting_contract",
        lambda: fake_contract,
    )

    return TestClient(app)


def test_list_elections_returns_empty_list(client):
    response = client.get("/api/v1/elections")

    assert response.status_code == 200
    assert response.json() == {
        "total_elections": 0,
        "elections": [],
    }


@pytest.mark.parametrize(
    "endpoint",
    [
        "/api/v1/elections/1",
        "/api/v1/elections/1/candidates",
        "/api/v1/elections/1/status",
        "/api/v1/elections/1/results",
        "/api/v1/elections/1/voting-config",
    ],
)
def test_nonexistent_election_returns_404(client, endpoint):
    response = client.get(endpoint)

    assert response.status_code == 404
    assert response.json() == {
        "detail": "Election 1 does not exist."
    }


def test_voting_config_returns_unpublished_key(monkeypatch):
    test_client = create_populated_client(
        monkeypatch,
        public_key=b"",
    )

    response = test_client.get(
        "/api/v1/elections/1/voting-config"
    )

    assert response.status_code == 200

    data = response.json()

    assert data == {
        "election_id": 1,
        "semaphore_group_id": 12345,
        "semaphore_scope": 67890,
        "encryption_public_key": "",
        "public_key_published": False,
    }

    test_client.close()


def test_voting_config_returns_published_key(monkeypatch):
    public_key = bytes(range(32))

    test_client = create_populated_client(
        monkeypatch,
        public_key=public_key,
    )

    response = test_client.get(
        "/api/v1/elections/1/voting-config"
    )

    assert response.status_code == 200

    data = response.json()

    assert data["election_id"] == 1
    assert data["semaphore_group_id"] == 12345
    assert data["semaphore_scope"] == 67890
    assert data["encryption_public_key"] == (
        "0x" + public_key.hex()
    )
    assert data["public_key_published"] is True

    test_client.close()
