# Campfire phone bridge for ROS 2

This ROS 2 Jazzy package turns consented smartphone observations into bounded
movement in turtlesim. It is a simulator adapter, not a physical robot driver.
The default and launch-time safety checks reject generic physical-robot topics
such as /cmd_vel.

## Safety boundary

- Output defaults to /turtle1/cmd_vel.
- The node accepts only /turtleN/cmd_vel or cmd_vel beneath /sim,
  /simulation, or /gazebo.
- The final resolved topic is checked after ROS remapping, so a command-line
  remap to /cmd_vel is rejected.
- Linear velocity is bounded to 0.8 by default and never above 2.0.
- Angular velocity is bounded to 2.0 by default and never above 4.0.
- The watchdog publishes a zero Twist when vision data is stale.
- The runtime gate cannot be disabled by configuration.
- Every RUNNING heartbeat is bound to a job_id and a fresh run_id.
- Vision is rejected unless both identifiers match the active runtime lease.
- A missed runtime heartbeat expires the lease and publishes zero Twist even
  if the final STOPPED event was lost.
- IMU, GPS, and transcripts are observations only. They never directly create
  velocity commands, and transcript text and GPS coordinates are not logged.

Do not add a relay or remap from the simulator namespace to a physical robot.
Doing so would bypass the package boundary and is outside its supported use.

## Prerequisites

The compatibility target is ROS 2 Jazzy on Ubuntu 24.04, including Ubuntu in
WSL2. Install the ROS packages:

    sudo apt update
    sudo apt install ros-jazzy-rosbridge-server ros-jazzy-turtlesim \
      python3-colcon-common-extensions

Create a workspace and copy or clone this package into its src directory:

    mkdir -p ~/campfire_ros2_ws/src
    cp -r campfire_phone_bridge ~/campfire_ros2_ws/src/
    cd ~/campfire_ros2_ws
    source /opt/ros/jazzy/setup.bash
    colcon build --symlink-install
    source install/setup.bash

## Start locally

For the browser and ROS 2 on the same computer:

    ros2 launch campfire_phone_bridge phone_sim.launch.py

Then connect the phone runtime to:

    ws://127.0.0.1:9090

Loopback is intentionally the default. For a phone on the same trusted LAN,
bind rosbridge to all interfaces explicitly and use the computer's LAN IP:

    ros2 launch campfire_phone_bridge phone_sim.launch.py \
      rosbridge_address:=0.0.0.0

    ws://192.168.x.x:9090

Limit port 9090 to the trusted LAN with the host firewall. Do not expose an
unauthenticated rosbridge endpoint to the public internet.

## HTTPS phone site and WSS

A page loaded through HTTPS cannot connect to an insecure ws:// endpoint.
Use wss:// and terminate TLS at a reverse proxy in front of rosbridge:

    phone browser -- wss://ros.example.com/rosbridge
                  -- TLS reverse proxy on 443
                  -- ws://127.0.0.1:9090
                  -- rosbridge and ROS 2

The reverse proxy needs a trusted certificate and WebSocket upgrade support.
Keep rosbridge bound to 127.0.0.1 behind that proxy. Put the endpoint behind a
VPN or an authentication-aware gateway, restrict allowed origins where the
gateway supports it, and never publish raw port 9090 to the internet. A public
site URL alone does not make a private LAN rosbridge reachable.

## Topic contract

Phone-to-ROS topics:

| Topic | ROS type | Adapter behavior |
| --- | --- | --- |
| /campfire/phone/imu | sensor_msgs/msg/Imu | Counts evidence only |
| /campfire/phone/navsat | sensor_msgs/msg/NavSatFix | Counts evidence only |
| /campfire/phone/vision | std_msgs/msg/String | Bounded simulator steering |
| /campfire/phone/transcript | std_msgs/msg/String | Counts only; text is not logged |
| /campfire/phone/runtime | std_msgs/msg/String | Opens or closes RUNNING gate |

ROS-to-phone topic:

| Topic | ROS type | Meaning |
| --- | --- | --- |
| /campfire/phone/feedback | std_msgs/msg/String | JSON status for display, optional speech, or vibration |

RUNNING must be JSON with this exact schema and identifier binding:

    {
      "schema": "campfire.phone-runtime.v1",
      "job_id": "job_01H...",
      "run_id": "550e8400-e29b-41d4-a716-446655440000",
      "state": "RUNNING",
      "lease_ms": 3000
    }

Send that event immediately when a run starts and renew it every 1000 ms. The
recommended lease is 3000 ms; the adapter accepts 500 through 5000 ms with the
provided configuration. The same job_id and run_id must be used for the whole
run. A STOPPED, FAILED, or ABORTED state closes the gate and sends zero
velocity. Invalid runtime JSON also fails closed. A bare RUNNING string is not
accepted.

Vision is JSON inside std_msgs/msg/String and must carry the active binding:

    {
      "schema": "campfire.phone-vision.v1",
      "job_id": "job_01H...",
      "run_id": "550e8400-e29b-41d4-a716-446655440000",
      "motion": {
        "moving": true,
        "confidence": 0.72,
        "centroid": {"x": 0.35, "y": 0.52}
      }
    }

centroid.x and confidence are normalized to the range 0 through 1. The adapter
rejects missing or mismatched identifiers before generating a command. This is
motion tracking, not person identification.

## rosbridge JSON example

A native browser WebSocket can advertise and publish the runtime gate:

    {"op":"advertise","topic":"/campfire/phone/runtime",
     "type":"std_msgs/msg/String"}

    {"op":"publish","topic":"/campfire/phone/runtime","msg":{"data":"{\"schema\":\"campfire.phone-runtime.v1\",\"job_id\":\"job_01H...\",\"run_id\":\"550e8400-e29b-41d4-a716-446655440000\",\"state\":\"RUNNING\",\"lease_ms\":3000}"}}

Use the same rosbridge v2 advertise/publish operations for the other topics.
Renew the runtime event once per second and subscribe to
/campfire/phone/feedback with type std_msgs/msg/String.

## Run without the bundled launcher

Start each process in a separate sourced terminal:

    ros2 run turtlesim turtlesim_node
    ros2 launch rosbridge_server rosbridge_websocket_launch.xml
    ros2 run campfire_phone_bridge phone_sim_adapter

The standalone rosbridge launch may bind more broadly than this package's
loopback-default launcher. Inspect its bind address before using it on a
network.

## Verify the safety behavior

Watch commands:

    ros2 topic echo /turtle1/cmd_vel

Stop phone vision updates while turtlesim is moving. Within the configured
vision timeout, the adapter publishes zero Twist and reports vision_timeout.
Resume vision, then stop only the runtime heartbeat. When its lease expires,
the adapter independently publishes zero Twist and reports
runtime_lease_expired on /campfire/phone/feedback.

An unsafe destination fails at startup:

    ros2 run campfire_phone_bridge phone_sim_adapter \
      --ros-args -p cmd_vel_topic:=/cmd_vel

The same is true for an unsafe remap:

    ros2 run campfire_phone_bridge phone_sim_adapter \
      --ros-args -r /turtle1/cmd_vel:=/cmd_vel

This package can prove its own configured and resolved output topic. It cannot
detect an external ROS relay created elsewhere, so simulator network isolation
remains part of the operating boundary.
