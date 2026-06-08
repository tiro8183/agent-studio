"""workspace read model compatibility

Revision ID: 0002_workspace_read_model_compat
Revises: 0001_agent_forge_baseline
Create Date: 2026-06-08 17:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = "0002_workspace_read_model_compat"
down_revision: Union[str, Sequence[str], None] = "0001_agent_forge_baseline"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "agent_release_snapshots" in inspector.get_table_names():
        snapshot_columns = {column["name"] for column in inspector.get_columns("agent_release_snapshots")}
        if "manifest_hash" not in snapshot_columns:
            op.add_column(
                "agent_release_snapshots",
                sa.Column("manifest_hash", sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=""),
            )
            op.create_index(
                op.f("ix_agent_release_snapshots_manifest_hash"),
                "agent_release_snapshots",
                ["manifest_hash"],
                unique=False,
            )

    if "run_events" not in inspector.get_table_names():
        op.create_table(
            "run_events",
            sa.Column("id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
            sa.Column("org_id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
            sa.Column("agent_id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
            sa.Column("run_id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
            sa.Column("seq", sa.Integer(), nullable=False),
            sa.Column("step_id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
            sa.Column("parent_seq", sa.Integer(), nullable=True),
            sa.Column("phase", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
            sa.Column("type", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
            sa.Column("label", sa.Text(), nullable=False),
            sa.Column("status", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
            sa.Column("timestamp", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
            sa.Column("elapsed_ms", sa.Integer(), nullable=False),
            sa.Column("duration_ms", sa.Integer(), nullable=False),
            sa.Column("resource", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
            sa.Column("call_id", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
            sa.Column("subagent", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
            sa.Column("task", sa.Text(), nullable=True),
            sa.Column("input_preview", sa.Text(), nullable=False),
            sa.Column("output_preview", sa.Text(), nullable=False),
            sa.Column("metadata_json", sa.Text(), nullable=False),
            sa.Column("input_json", sa.Text(), nullable=False),
            sa.Column("output_json", sa.Text(), nullable=False),
            sa.Column("created_at", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("run_id", "seq", name="uq_run_events_run_seq"),
        )
        op.create_index(op.f("ix_run_events_agent_id"), "run_events", ["agent_id"], unique=False)
        op.create_index(op.f("ix_run_events_call_id"), "run_events", ["call_id"], unique=False)
        op.create_index("ix_run_events_org_agent_created", "run_events", ["org_id", "agent_id", "created_at"], unique=False)
        op.create_index(op.f("ix_run_events_org_id"), "run_events", ["org_id"], unique=False)
        op.create_index("ix_run_events_org_run_seq", "run_events", ["org_id", "run_id", "seq"], unique=False)
        op.create_index("ix_run_events_org_type_created", "run_events", ["org_id", "type", "created_at"], unique=False)
        op.create_index(op.f("ix_run_events_phase"), "run_events", ["phase"], unique=False)
        op.create_index(op.f("ix_run_events_resource"), "run_events", ["resource"], unique=False)
        op.create_index(op.f("ix_run_events_run_id"), "run_events", ["run_id"], unique=False)
        op.create_index(op.f("ix_run_events_seq"), "run_events", ["seq"], unique=False)
        op.create_index(op.f("ix_run_events_status"), "run_events", ["status"], unique=False)
        op.create_index(op.f("ix_run_events_step_id"), "run_events", ["step_id"], unique=False)
        op.create_index(op.f("ix_run_events_subagent"), "run_events", ["subagent"], unique=False)
        op.create_index(op.f("ix_run_events_type"), "run_events", ["type"], unique=False)


def downgrade() -> None:
    pass
