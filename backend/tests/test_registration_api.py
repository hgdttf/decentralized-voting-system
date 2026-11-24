
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
    """Simulate registration-related Voting contract functions."""

    def __init__(
        self,
        next_election_id=2,
        registered=False,
        should_fail=False,
    ):
        self.next_election_id = next_election_id
        self.registered = registered
        self.should_fail = should_fail

    def nextElectionId(self):
        if self.should_fail:
            raise RuntimeError("Simulated blockchain failure.")

        return FakeCall(self.next_election_id)

    def registeredCommitments(self, election_id, commitment):
        if self.should_fail:
            raise RuntimeError("Simulated blockchain failure.")

        return FakeCall(self.registered)


class FakeContract:
    """Simulate the Voting smart contract."""

    def __init__(
        self,
        next_election_id=2,
        registered=False,
        should_fail=False,
    ):
        self.functions = FakeFunctions(
            next_election_id=next_election_id,
            registered=registered,
            should_fail=should_fail,
        )


@pytest.fixture
def client(monkeypatch):
    """Provide an API client with a simulated registered commitment."""

    fake_contract = FakeContract(registered=True)

    monkeypatch.setattr(
        blockchain_service,
        "get_voting_contract",
        lambda: fake_contract,
    )

    return TestClient(app)


def create_client(monkeypatch, fake_contract):
    """Create a test client using a specified fake contract."""

    monkeypatch.setattr(
        blockchain_service,
        "get_voting_contract",
        lambda: fake_contract,
    )

    return TestClient(app)


def test_registered_commitment_returns_true(client):
    response = client.get(
        "/api/v1/elections/1/registration/12345"
    )

    assert response.status_code == 200
    assert response.json() == {
        "election_id": 1,
        "commitment": "12345",
        "registered": True,
    }

    client.close()


def test_unregistered_commitment_returns_false(monkeypatch):
    test_client = create_client(
        monkeypatch,
        FakeContract(registered=False),
    )

    response = test_client.get(
        "/api/v1/elections/1/registration/12345"
    )

    assert response.status_code == 200
    assert response.json()["registered"] is False

    test_client.close()


def test_nonexistent_election_returns_404(monkeypatch):
    test_client = create_client(
        monkeypatch,
        FakeContract(next_election_id=2),
    )

    response = test_client.get(
        "/api/v1/elections/2/registration/12345"
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Election 2 does not exist."

    test_client.close()


@pytest.mark.parametrize(
    "commitment",
    [
        "0",
        "-1",
        "abc",
        "12.5",
        "１２３",
        str(1 << 256),
    ],
)
def test_invalid_commitment_returns_400(client, commitment):
    response = client.get(
        f"/api/v1/elections/1/registration/{commitment}"
    )

    assert response.status_code == 400

    client.close()


def test_commitment_larger_than_javascript_safe_integer_is_preserved(
    monkeypatch,
):
    commitment = "900719925474099312345678901234567890"

    test_client = create_client(
        monkeypatch,
        FakeContract(registered=True),
    )

    response = test_client.get(
        f"/api/v1/elections/1/registration/{commitment}"
    )

    assert response.status_code == 200
    assert response.json()["commitment"] == commitment

    test_client.close()


def test_blockchain_failure_returns_503(monkeypatch):
    test_client = create_client(
        monkeypatch,
        FakeContract(should_fail=True),
    )

    response = test_client.get(
        "/api/v1/elections/1/registration/12345"
    )

    assert response.status_code == 503

    test_client.close()
