from glob import glob
from setuptools import find_packages, setup


package_name = "campfire_phone_bridge"


setup(
    name=package_name,
    version="0.1.0",
    packages=find_packages(exclude=("test",)),
    data_files=[
        (
            "share/ament_index/resource_index/packages",
            ["resource/" + package_name],
        ),
        ("share/" + package_name, ["package.xml"]),
        ("share/" + package_name + "/config", glob("config/*.yaml")),
        ("share/" + package_name + "/launch", glob("launch/*.launch.py")),
    ],
    install_requires=["setuptools"],
    zip_safe=True,
    maintainer="Puro-33",
    maintainer_email="puro-33@users.noreply.github.com",
    description=(
        "Simulation-only ROS 2 adapter for Campfire smartphone observations."
    ),
    license="Apache-2.0",
    entry_points={
        "console_scripts": [
            "phone_sim_adapter = "
            "campfire_phone_bridge.phone_sim_adapter:main",
        ],
    },
)
