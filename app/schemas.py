from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
Code = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_.-]+$")]
Qty = Annotated[int, Field(strict=True, gt=0, le=100000000)]

class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")

class LoginInput(Input):
    username: Code
    password: Annotated[str, Field(min_length=1, max_length=256)]

class StepInput(Input):
    name: Text
    work_center: Text

class BomInput(Input):
    material: Code
    per_unit: Qty
    unit: Literal["pcs"] = "pcs"

class RouteInput(Input):
    product: Code
    revision: Qty
    name: Text
    steps: Annotated[list[StepInput], Field(min_length=1, max_length=100)]
    bom: Annotated[list[BomInput], Field(min_length=1, max_length=100)]

    @model_validator(mode="after")
    def unique_materials(self):
        if len({x.material for x in self.bom}) != len(self.bom):
            raise ValueError("BOM materials must be unique")
        return self

class OrderInput(Input):
    code: Code
    route_id: Qty
    planned_qty: Qty

class LotInput(Input):
    code: Code
    material: Code
    quantity: Qty

class LotQualityInput(Input):
    decision: Literal["released", "rejected"]
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=500)]

class Allocation(Input):
    lot_id: Qty
    quantity: Qty

class ActionInput(Input):
    version: Qty
    action: Literal["release", "record", "hold", "resume", "quality", "complete"]
    allocations: Annotated[list[Allocation], Field(max_length=200)] = []
    operation_id: int | None = None
    good: Annotated[int, Field(strict=True, ge=0, le=100000000)] = 0
    scrap: Annotated[int, Field(strict=True, ge=0, le=100000000)] = 0
    finish: bool = False
    decision: Literal["pass", "fail"] | None = None
    reason: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] = ""
