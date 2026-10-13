cmake_minimum_required(VERSION 3.16)
project(ProjectOverlord VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_executable(overlord
  src/main.cpp
  src/world.cpp
  src/player.cpp
  src/ballistics.cpp
  src/vehicle.cpp
  src/ai.cpp
  src/editor.cpp
  src/game.cpp
)

target_include_directories(overlord PRIVATE src)
target_compile_options(overlord PRIVATE -O2 -Wall -Wextra)

enable_testing()
add_test(NAME simtest COMMAND overlord --simtest)
