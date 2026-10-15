export const PHYSICS = {
  runSpeed: 285,
  acceleration: 2_300,
  friction: 2_500,
  jumpSpeed: 510,
  minimumJumpSpeed: 320,
  wallJumpX: 350,
  gravity: 1_250,
  coyoteMs: 105,
  jumpBufferMs: 120,
  dashSpeed: 690,
  dashDurationMs: 135,
  dashCooldownMs: 780,
} as const;

export function jumpVelocityAfterRelease(velocityY: number, jumpHeld: boolean) {
  if (!jumpHeld && velocityY < -PHYSICS.minimumJumpSpeed) return -PHYSICS.minimumJumpSpeed;
  return velocityY;
}
