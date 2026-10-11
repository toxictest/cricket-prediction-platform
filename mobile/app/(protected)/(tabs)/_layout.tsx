import React from "react";
import { Tabs } from "expo-router";
import { CyberTabBar } from "../../../src/components/CyberTabBar";

export default function TabsLayout() {
  return (
    <Tabs tabBar={(props) => <CyberTabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ tabBarLabel: "MATCHES" }} />
      <Tabs.Screen name="wallet" options={{ tabBarLabel: "WALLET" }} />
      <Tabs.Screen name="profile" options={{ tabBarLabel: "PROFILE" }} />
    </Tabs>
  );
}
