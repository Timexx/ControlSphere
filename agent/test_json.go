package main

import (
	"encoding/json"
	"fmt"
)

type RegisterMessage struct {
	Type      string `json:"type"`
	Hostname  string `json:"hostname"`
	IP        string `json:"ip"`
	SecretKey string `json:"secretKey"`
}

func main() {
	msg := RegisterMessage{
		Type:      "register",
		Hostname:  "test",
		IP:        "192.168.1.1",
		SecretKey: "ce5064e07b694f02053ec333a67ee80858d5135e4b2206c02311ef14f3723e84",
	}
	
	data, _ := json.Marshal(msg)
	fmt.Println(string(data))
}
