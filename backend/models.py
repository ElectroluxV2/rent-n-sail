from decimal import Decimal

from sqlalchemy import CheckConstraint, Numeric, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Boat(Base):
    __tablename__ = "boats"
    __table_args__ = (CheckConstraint("daily_rate >= 0", name="positive_daily_rate"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    daily_rate: Mapped[Decimal] = mapped_column(Numeric(10, 2))
