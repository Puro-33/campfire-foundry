"""Convert Campfire phone observations into bounded simulator motion.

This node intentionally publishes only to simulator-shaped topic names.  It is
not a robot driver and it contains no physical actuator integration.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
import math
import re
from typing import Any

import rclpy
from geometry_msgs.msg import Twist
from rclpy.node import Node
from rclpy.qos import qos_profile_sensor_data
from sensor_msgs.msg import Imu, NavSatFix
from std_msgs.msg import String


_SIMULATION_TOPIC = re.compile(
    r"^/(?:turtle[0-9]+|sim(?:ulation)?(?:/[A-Za-z0-9_-]+)*"
    r"|gazebo(?:/[A-Za-z0-9_-]+)*)/cmd_vel$"
)
_RUNTIME_SCHEMA = "campfire.phone-runtime.v1"
_VISION_SCHEMA = "campfire.phone-vision.v1"
_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


def _as_finite_number(value: Any, field_name: str) -> float:
    """Return a finite float or raise a useful validation error."""
    if isinstance(value, bool):
        raise ValueError(f"{field_name} must be a number")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} must be a number") from exc
    if not math.isfinite(number):
        raise ValueError(f"{field_name} must be finite")
    return number


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def _is_simulation_topic(topic_name: str) -> bool:
    """Allow only explicit turtlesim/simulation namespaces."""
    return bool(_SIMULATION_TOPIC.fullmatch(topic_name))


def _validated_identifier(value: Any, field_name: str) -> str:
    """Validate an identifier used to bind observations to one run."""
    if not isinstance(value, str) or not _IDENTIFIER.fullmatch(value):
        raise ValueError(
            f"{field_name} must be 1-128 safe identifier characters"
        )
    return value


class PhoneSimulationAdapter(Node):
    """Drive a simulator from phone-side motion observations."""

    def __init__(self) -> None:
        super().__init__("campfire_phone_sim_adapter")

        self.declare_parameter("simulation_only", True)
        self.declare_parameter("cmd_vel_topic", "/turtle1/cmd_vel")
        self.declare_parameter("max_linear_speed", 0.8)
        self.declare_parameter("max_angular_speed", 2.0)
        self.declare_parameter("minimum_confidence", 0.20)
        self.declare_parameter("vision_timeout_seconds", 0.75)
        self.declare_parameter("require_runtime_running", True)
        self.declare_parameter("minimum_runtime_lease_ms", 500)
        self.declare_parameter("maximum_runtime_lease_ms", 5000)

        simulation_only = bool(
            self.get_parameter("simulation_only").value
        )
        if not simulation_only:
            raise RuntimeError(
                "simulation_only is immutable for this package; "
                "physical actuation is not supported"
            )

        requested_topic = str(
            self.get_parameter("cmd_vel_topic").value
        )
        if not _is_simulation_topic(requested_topic):
            raise RuntimeError(
                "Unsafe cmd_vel_topic. Use /turtleN/cmd_vel or a topic under "
                "/sim, /simulation, or /gazebo."
            )

        self._max_linear = _as_finite_number(
            self.get_parameter("max_linear_speed").value,
            "max_linear_speed",
        )
        self._max_angular = _as_finite_number(
            self.get_parameter("max_angular_speed").value,
            "max_angular_speed",
        )
        self._minimum_confidence = _clamp(
            _as_finite_number(
                self.get_parameter("minimum_confidence").value,
                "minimum_confidence",
            ),
            0.0,
            1.0,
        )
        self._vision_timeout = _as_finite_number(
            self.get_parameter("vision_timeout_seconds").value,
            "vision_timeout_seconds",
        )
        self._require_runtime = bool(
            self.get_parameter("require_runtime_running").value
        )
        if not self._require_runtime:
            raise RuntimeError(
                "require_runtime_running is immutable; every simulator "
                "command requires a live runtime lease"
            )
        self._minimum_runtime_lease_ms = _as_finite_number(
            self.get_parameter("minimum_runtime_lease_ms").value,
            "minimum_runtime_lease_ms",
        )
        self._maximum_runtime_lease_ms = _as_finite_number(
            self.get_parameter("maximum_runtime_lease_ms").value,
            "maximum_runtime_lease_ms",
        )

        if self._max_linear <= 0.0 or self._max_linear > 2.0:
            raise RuntimeError("max_linear_speed must be in (0.0, 2.0]")
        if self._max_angular <= 0.0 or self._max_angular > 4.0:
            raise RuntimeError("max_angular_speed must be in (0.0, 4.0]")
        if self._vision_timeout < 0.10 or self._vision_timeout > 5.0:
            raise RuntimeError(
                "vision_timeout_seconds must be in [0.10, 5.0]"
            )
        if (
            self._minimum_runtime_lease_ms < 250
            or self._minimum_runtime_lease_ms > 1000
        ):
            raise RuntimeError(
                "minimum_runtime_lease_ms must be in [250, 1000]"
            )
        if (
            self._maximum_runtime_lease_ms
            < self._minimum_runtime_lease_ms
            or self._maximum_runtime_lease_ms > 5000
        ):
            raise RuntimeError(
                "maximum_runtime_lease_ms must be between the minimum and "
                "the hard safety cap of 5000"
            )

        self._cmd_vel_pub = self.create_publisher(
            Twist,
            requested_topic,
            10,
        )
        # ROS remapping is resolved by create_publisher. Validate the final
        # destination as well, so a CLI remap cannot silently target /cmd_vel.
        resolved_topic = self._cmd_vel_pub.topic_name
        if not _is_simulation_topic(resolved_topic):
            self.destroy_publisher(self._cmd_vel_pub)
            raise RuntimeError(
                f"Unsafe remapped output topic rejected: {resolved_topic}"
            )

        self._feedback_pub = self.create_publisher(
            String,
            "/campfire/phone/feedback",
            10,
        )

        self.create_subscription(
            Imu,
            "/campfire/phone/imu",
            self._on_imu,
            qos_profile_sensor_data,
        )
        self.create_subscription(
            NavSatFix,
            "/campfire/phone/navsat",
            self._on_navsat,
            qos_profile_sensor_data,
        )
        self.create_subscription(
            String,
            "/campfire/phone/vision",
            self._on_vision,
            10,
        )
        self.create_subscription(
            String,
            "/campfire/phone/transcript",
            self._on_transcript,
            10,
        )
        self.create_subscription(
            String,
            "/campfire/phone/runtime",
            self._on_runtime,
            10,
        )

        self._runtime_running = False
        self._active_job_id: str | None = None
        self._active_run_id: str | None = None
        self._runtime_lease_deadline_seconds: float | None = None
        self._last_valid_vision_seconds: float | None = None
        self._moving = False
        self._imu_messages = 0
        self._navsat_messages = 0
        self._transcript_messages = 0
        self._watchdog = self.create_timer(0.10, self._on_watchdog)

        self._publish_feedback(
            "READY",
            "Simulation bridge ready; waiting for RUNNING and vision data.",
            {
                "cmd_vel_topic": resolved_topic,
                "simulation_only": True,
            },
        )
        self.get_logger().info(
            "Campfire phone adapter is simulation-only; publishing to "
            f"{resolved_topic}"
        )

    def _now_seconds(self) -> float:
        return self.get_clock().now().nanoseconds / 1_000_000_000.0

    def _publish_feedback(
        self,
        event: str,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        payload: dict[str, Any] = {
            "schema": "campfire.ros-feedback.v1",
            "event": event,
            "message": message[:240],
            "time": datetime.now(timezone.utc).isoformat(),
            "simulation_only": True,
        }
        if details:
            payload["details"] = details
        output = String()
        output.data = json.dumps(
            payload,
            separators=(",", ":"),
            ensure_ascii=True,
        )
        self._feedback_pub.publish(output)

    def _publish_stop(self, reason: str, force: bool = False) -> None:
        if not self._moving and not force:
            return
        self._cmd_vel_pub.publish(Twist())
        self._moving = False
        self._publish_feedback(
            "STOPPED",
            "Simulator velocity set to zero.",
            {"reason": reason},
        )

    def _on_imu(self, _message: Imu) -> None:
        # IMU is counted as evidence but never converted directly into motion.
        self._imu_messages += 1

    def _on_navsat(self, _message: NavSatFix) -> None:
        # Coordinates are deliberately not logged or echoed in feedback.
        self._navsat_messages += 1

    def _on_transcript(self, message: String) -> None:
        # Do not log, retain, or echo transcript contents.
        self._transcript_messages += 1
        if len(message.data) > 20_000:
            self.get_logger().warning(
                "Oversized transcript observation ignored by the adapter"
            )

    def _close_runtime_gate(
        self,
        reason: str,
        force_zero: bool = True,
    ) -> None:
        self._runtime_running = False
        self._active_job_id = None
        self._active_run_id = None
        self._runtime_lease_deadline_seconds = None
        self._publish_stop(reason, force=force_zero)

    def _on_runtime(self, message: String) -> None:
        try:
            decoded = json.loads(message.data)
            if not isinstance(decoded, dict):
                raise ValueError("runtime payload must be a JSON object")
            if decoded.get("schema") != _RUNTIME_SCHEMA:
                raise ValueError(
                    f"schema must be {_RUNTIME_SCHEMA}"
                )
            state = str(decoded.get("state", "")).strip().upper()
        except (json.JSONDecodeError, ValueError) as exc:
            self._close_runtime_gate("invalid_runtime_payload")
            self._publish_feedback(
                "REJECTED",
                "Runtime event rejected and gate closed.",
                {"reason": str(exc)[:160]},
            )
            return

        if state != "RUNNING":
            self._close_runtime_gate(
                f"runtime_{state.lower() or 'not_running'}"
            )
            return

        try:
            job_id = _validated_identifier(
                decoded.get("job_id"),
                "job_id",
            )
            run_id = _validated_identifier(
                decoded.get("run_id"),
                "run_id",
            )
            lease_ms = _as_finite_number(
                decoded.get("lease_ms"),
                "lease_ms",
            )
            if (
                lease_ms < self._minimum_runtime_lease_ms
                or lease_ms > self._maximum_runtime_lease_ms
            ):
                raise ValueError(
                    "lease_ms is outside the configured safety range"
                )
        except ValueError as exc:
            self._close_runtime_gate("invalid_runtime_lease")
            self._publish_feedback(
                "REJECTED",
                "RUNNING lease rejected and gate closed.",
                {"reason": str(exc)[:160]},
            )
            return

        now = self._now_seconds()
        if (
            self._runtime_running
            and self._runtime_lease_deadline_seconds is not None
            and now > self._runtime_lease_deadline_seconds
        ):
            self._close_runtime_gate("runtime_lease_expired")

        active_pair = (self._active_job_id, self._active_run_id)
        incoming_pair = (job_id, run_id)
        if (
            self._runtime_running
            and active_pair != incoming_pair
        ):
            self._close_runtime_gate("runtime_binding_mismatch")
            self._publish_feedback(
                "REJECTED",
                "RUNNING lease identifiers changed; gate closed.",
            )
            return

        was_running = self._runtime_running
        self._active_job_id = job_id
        self._active_run_id = run_id
        self._runtime_lease_deadline_seconds = (
            now + lease_ms / 1000.0
        )
        self._runtime_running = True
        if not was_running:
            self._publish_feedback(
                "RUNNING",
                "Bound runtime lease opened for simulator commands.",
                {
                    "job_id": job_id,
                    "run_id": run_id,
                    "lease_ms": int(lease_ms),
                },
            )

    def _on_vision(self, message: String) -> None:
        try:
            observation = json.loads(message.data)
            if not isinstance(observation, dict):
                raise ValueError("vision payload must be a JSON object")
            if observation.get("schema") != _VISION_SCHEMA:
                raise ValueError(
                    f"schema must be {_VISION_SCHEMA}"
                )
            job_id = _validated_identifier(
                observation.get("job_id"),
                "job_id",
            )
            run_id = _validated_identifier(
                observation.get("run_id"),
                "run_id",
            )
            motion = observation.get("motion", observation)
            if not isinstance(motion, dict):
                raise ValueError("motion must be a JSON object")

            centroid = motion.get("centroid", {})
            if not isinstance(centroid, dict):
                centroid = {}
            x_value = centroid.get(
                "x",
                motion.get(
                    "centroidX",
                    motion.get("x"),
                ),
            )
            confidence_value = motion.get(
                "confidence",
                observation.get("confidence", 0.0),
            )
            centroid_x = _clamp(
                _as_finite_number(x_value, "centroid.x"),
                0.0,
                1.0,
            )
            confidence = _clamp(
                _as_finite_number(
                    confidence_value,
                    "confidence",
                ),
                0.0,
                1.0,
            )
            moving_value = motion.get(
                "moving",
                observation.get("moving", confidence > 0.0),
            )
            moving = bool(moving_value)
        except (json.JSONDecodeError, ValueError) as exc:
            self._publish_stop("invalid_vision_payload")
            self._publish_feedback(
                "REJECTED",
                "Vision observation rejected.",
                {"reason": str(exc)[:160]},
            )
            return

        now = self._now_seconds()
        if (
            not self._runtime_running
            or self._runtime_lease_deadline_seconds is None
            or now > self._runtime_lease_deadline_seconds
        ):
            self._close_runtime_gate("runtime_lease_missing_or_expired")
            self._publish_feedback(
                "REJECTED",
                "Vision observation has no live runtime lease.",
            )
            return
        if (
            job_id != self._active_job_id
            or run_id != self._active_run_id
        ):
            self._publish_stop("vision_binding_mismatch", force=True)
            self._publish_feedback(
                "REJECTED",
                "Vision identifiers do not match the active runtime.",
            )
            return

        self._last_valid_vision_seconds = now
        if not moving or confidence < self._minimum_confidence:
            self._publish_stop("no_confident_motion")
            return

        horizontal_error = 0.5 - centroid_x
        angular = _clamp(
            horizontal_error * 2.0 * self._max_angular,
            -self._max_angular,
            self._max_angular,
        )
        alignment = max(0.0, 1.0 - abs(horizontal_error) * 1.6)
        linear = _clamp(
            self._max_linear * confidence * alignment,
            0.0,
            self._max_linear,
        )

        command = Twist()
        command.linear.x = linear
        command.angular.z = angular
        self._cmd_vel_pub.publish(command)
        self._moving = linear > 0.0 or abs(angular) > 0.0

    def _on_watchdog(self) -> None:
        now = self._now_seconds()
        if (
            self._runtime_running
            and (
                self._runtime_lease_deadline_seconds is None
                or now > self._runtime_lease_deadline_seconds
            )
        ):
            self._close_runtime_gate("runtime_lease_expired")
            return
        if not self._moving:
            return
        if self._last_valid_vision_seconds is None:
            self._publish_stop("vision_never_received")
            return
        age = now - self._last_valid_vision_seconds
        if age > self._vision_timeout:
            self._publish_stop("vision_timeout")

    def stop_before_shutdown(self) -> None:
        """Publish a final zero velocity before the ROS context is closed."""
        self._publish_stop("node_shutdown", force=True)


def main(args: list[str] | None = None) -> None:
    rclpy.init(args=args)
    node: PhoneSimulationAdapter | None = None
    try:
        node = PhoneSimulationAdapter()
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        if node is not None:
            if rclpy.ok():
                node.stop_before_shutdown()
            node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == "__main__":
    main()
