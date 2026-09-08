"""Launch rosbridge, turtlesim, and the Campfire simulation adapter."""

from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, LogInfo
from launch.conditions import IfCondition
from launch.substitutions import LaunchConfiguration, PathJoinSubstitution
from launch_ros.actions import Node
from launch_ros.parameter_descriptions import ParameterValue
from launch_ros.substitutions import FindPackageShare


def generate_launch_description() -> LaunchDescription:
    package_share = FindPackageShare("campfire_phone_bridge")
    default_parameters = PathJoinSubstitution(
        [package_share, "config", "topics.yaml"]
    )

    start_turtlesim = LaunchConfiguration("start_turtlesim")
    start_rosbridge = LaunchConfiguration("start_rosbridge")
    rosbridge_address = LaunchConfiguration("rosbridge_address")
    rosbridge_port = LaunchConfiguration("rosbridge_port")
    cmd_vel_topic = LaunchConfiguration("cmd_vel_topic")

    return LaunchDescription(
        [
            DeclareLaunchArgument(
                "start_turtlesim",
                default_value="true",
                description="Start the turtlesim simulator.",
            ),
            DeclareLaunchArgument(
                "start_rosbridge",
                default_value="true",
                description="Start the rosbridge WebSocket server.",
            ),
            DeclareLaunchArgument(
                "rosbridge_address",
                default_value="127.0.0.1",
                description=(
                    "Bind address. Keep loopback unless intentionally using "
                    "a protected LAN, VPN, or TLS reverse proxy."
                ),
            ),
            DeclareLaunchArgument(
                "rosbridge_port",
                default_value="9090",
                description="rosbridge WebSocket port.",
            ),
            DeclareLaunchArgument(
                "cmd_vel_topic",
                default_value="/turtle1/cmd_vel",
                description=(
                    "Simulator velocity topic. Physical robot topics are "
                    "rejected by the adapter."
                ),
            ),
            LogInfo(
                msg=(
                    "Campfire phone bridge is SIMULATION ONLY. "
                    "No physical actuator output is provided."
                )
            ),
            Node(
                package="turtlesim",
                executable="turtlesim_node",
                name="campfire_turtlesim",
                output="screen",
                condition=IfCondition(start_turtlesim),
            ),
            Node(
                package="rosbridge_server",
                executable="rosbridge_websocket",
                name="campfire_rosbridge_websocket",
                output="screen",
                parameters=[
                    {
                        "address": rosbridge_address,
                        "port": ParameterValue(
                            rosbridge_port,
                            value_type=int,
                        ),
                    }
                ],
                condition=IfCondition(start_rosbridge),
            ),
            Node(
                package="campfire_phone_bridge",
                executable="phone_sim_adapter",
                name="campfire_phone_sim_adapter",
                output="screen",
                parameters=[
                    default_parameters,
                    {
                        "simulation_only": True,
                        "cmd_vel_topic": cmd_vel_topic,
                    },
                ],
            ),
        ]
    )
