cmake_minimum_required(VERSION 3.14)
project(pia_core VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include_directories(include)

add_library(pia_core SHARED
    src/pia_core.cpp
)

target_compile_definitions(pia_core PRIVATE PIA_CORE_EXPORTS)

set_target_properties(pia_core PROPERTIES
    OUTPUT_NAME "pia_core"
    PREFIX ""
)

