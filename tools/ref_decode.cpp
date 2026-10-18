// Reference decoder for the tests: feeds hex frames (one per line on stdin) to the C++ decoder of
// harbour-mahlebike and prints one JSON object per frame. Build: tools/gen_expected.sh
#include "protocol/mahle.h"
#include <cstdio>
#include <iostream>
#include <sstream>
#include <string>
using namespace Mahle;
int main()
{
    std::string line;
    while (std::getline(std::cin, line)) {
        Bytes b;
        std::istringstream is(line);
        std::string t;
        while (is >> t)
            b.push_back((uint8_t)std::stoi(t, nullptr, 16));
        Parser p;
        Kind k = p.feed(b);
        std::printf("{\"hex\":\"%s\",\"kind\":\"%s\"", line.c_str(), kindName(k));
        if (k == Kind::Battery) {
            auto &x = *p.battery();
            std::printf(",\"volt\":%.2f,\"soc\":%d,\"wh\":%.1f,\"number\":%d", x.voltage, x.soc, x.remainingWh, x.number);
        } else if (k == Kind::Motor) {
            auto &x = *p.motor();
            std::printf(",\"lvl\":%d,\"kmh\":%.1f,\"amp\":%.1f", x.assistLevel, x.speedKmh, x.currentAmp ? *x.currentAmp : -1.0);
        } else if (k == Kind::Ebm) {
            auto &x = *p.ebm();
            std::printf(",\"range_m\":%.1f", x.rangeKm * 1000);
        } else if (k == Kind::Assist) {
            auto &x = *p.assist();
            std::printf(",\"min\":%d,\"max\":%d,\"cur\":%d", x.min, x.max, x.current);
        }
        std::printf("}\n");
    }
}
